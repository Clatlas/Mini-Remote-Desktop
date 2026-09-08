param(
  [string]$TargetUser,
  [switch]$Elevated,
  [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$HyperVAdminsSid = 'S-1-5-32-578'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root '.runtime'
$ResultFile = Join-Path $Runtime 'hyperv-access-result.json'
$ErrorFile = Join-Path $Runtime 'hyperv-access-error.txt'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Get-CurrentIdentityName {
  return [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
}

function Test-IsAdministrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-HyperVGroup {
  $group = Get-CimInstance Win32_Group -Filter "SID='$HyperVAdminsSid'" -ErrorAction Stop | Select-Object -First 1
  if (-not $group) { throw "Built-in Hyper-V Administrators group ($HyperVAdminsSid) was not found." }
  return $group
}

function Test-AccountMembership([string]$User, $Group) {
  try {
    $members = @(Get-LocalGroupMember -Group $Group.Name -ErrorAction Stop)
    return [bool]($members | Where-Object {
      $_.Name -ieq $User -or
      ($_.Name -split '\\')[-1] -ieq ($User -split '\\')[-1]
    } | Select-Object -First 1)
  } catch {
    throw "Could not enumerate '$($Group.Name)' membership: $($_.Exception.Message)"
  }
}

function Test-TokenMembership {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  return [bool]($identity.Groups | Where-Object { $_.Value -eq $HyperVAdminsSid } | Select-Object -First 1)
}

function Write-Result([hashtable]$Value) {
  try {
    $Value.at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $Value | ConvertTo-Json -Depth 5 | Set-Content -Path $ResultFile -Encoding UTF8
  } catch {}
}

function Write-Failure([string]$Stage, [System.Exception]$Exception) {
  $message = if ($Exception) { $Exception.Message } else { 'Unknown error' }
  $detail = if ($Exception) { $Exception.ToString() } else { $message }
  try {
    @(
      "At: $([DateTimeOffset]::Now.ToString('o'))"
      "Stage: $Stage"
      "TargetUser: $TargetUser"
      "Elevated: $Elevated"
      "StatusOnly: $StatusOnly"
      "Message: $message"
      ''
      $detail
    ) | Set-Content -Path $ErrorFile -Encoding UTF8
  } catch {}
  Write-Result @{
    state = 'failed'
    stage = $Stage
    targetUser = $TargetUser
    error = $message
    errorFile = $ErrorFile
  }
  '=== MRD HYPER-V ACCESS FAILED ==='
  "Stage          : $Stage"
  "Target account : $TargetUser"
  "Error          : $message"
  "Details        : $ErrorFile"
}

if (-not $TargetUser) { $TargetUser = Get-CurrentIdentityName }

try {
  if ($StatusOnly) {
    $group = Get-HyperVGroup
    $accountMember = Test-AccountMembership $TargetUser $group
    $currentTokenMember = Test-TokenMembership

    '=== MRD HYPER-V ACCESS ==='
    "Target account : $TargetUser"
    "Group          : $($group.Name) [$HyperVAdminsSid]"
    "Account member : $accountMember"
    "Current token  : $currentTokenMember"
    if ($accountMember -and -not $currentTokenMember) {
      'Next           : Sign out/in or reboot Windows so the new group membership enters the MRD logon token.'
    } elseif ($accountMember -and $currentTokenMember) {
      'Next           : Access token is ready. Re-run Workspace Probe.'
    } else {
      'Next           : Run Hyper-V Access and approve the UAC prompt on HOME-PC.'
    }
    exit 0
  }

  if (-not (Test-IsAdministrator)) {
    # Use an encoded child payload instead of a quoted -File argument line.
    # This avoids nested quoting failures when MRD itself is running from an
    # EncodedCommand PowerShell process.
    $scriptLiteral = $PSCommandPath.Replace("'", "''")
    $userLiteral = $TargetUser.Replace("'", "''")
    $payload = "& '$scriptLiteral' -TargetUser '$userLiteral' -Elevated"
    $encodedPayload = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))

    try {
      $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', $encodedPayload
      ) -PassThru

      Write-Result @{
        state = 'uac-requested'
        stage = 'request-elevation'
        targetUser = $TargetUser
        elevatedProcessId = $child.Id
        message = 'UAC elevation was requested on the Home PC.'
      }
      '=== MRD HYPER-V ACCESS ==='
      "Target account : $TargetUser"
      'State          : UAC requested'
      "Helper PID     : $($child.Id)"
      'Action         : Approve the Windows UAC prompt on HOME-PC.'
      'After approval : Wait 3-5 seconds, then run HV Access Status.'
      exit 0
    } catch {
      Write-Failure 'request-elevation' $_.Exception
      exit 2
    }
  }

  $group = Get-HyperVGroup
  $beforeMember = Test-AccountMembership $TargetUser $group
  $currentTokenMember = Test-TokenMembership

  if (-not $beforeMember) {
    try {
      Add-LocalGroupMember -Group $group.Name -Member $TargetUser -ErrorAction Stop
    } catch {
      throw "Could not add '$TargetUser' to '$($group.Name)': $($_.Exception.Message)"
    }
  }

  $afterMember = Test-AccountMembership $TargetUser $group
  if (-not $afterMember) { throw "The account '$TargetUser' could not be verified in '$($group.Name)'." }

  $currentTokenMember = Test-TokenMembership
  Write-Result @{
    state = 'membership-added'
    stage = 'membership-complete'
    targetUser = $TargetUser
    group = $group.Name
    accountMemberBefore = $beforeMember
    accountMemberAfter = $afterMember
    currentTokenHasGroup = $currentTokenMember
    tokenRefreshRequired = (-not $currentTokenMember)
    message = if ($currentTokenMember) { 'Hyper-V access is active in the current token.' } else { 'Membership is installed; sign out/in or reboot is required to refresh the MRD logon token.' }
  }

  '=== MRD HYPER-V ACCESS SETUP ==='
  "Target account : $TargetUser"
  "Group          : $($group.Name) [$HyperVAdminsSid]"
  "Account member : $afterMember"
  "Current token  : $currentTokenMember"
  if ($currentTokenMember) {
    'Result         : READY'
    'Next           : Re-run Workspace Probe.'
  } else {
    'Result         : MEMBERSHIP INSTALLED'
    'Next           : Sign out/in or reboot Windows, restart MRD, then run Workspace Probe.'
  }
  exit 0
} catch {
  Write-Failure 'setup' $_.Exception
  exit 3
}
