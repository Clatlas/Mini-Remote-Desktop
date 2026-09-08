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
  $group = Get-LocalGroup -ErrorAction Stop | Where-Object { $_.SID.Value -eq $HyperVAdminsSid } | Select-Object -First 1
  if (-not $group) { throw "Built-in Hyper-V Administrators group ($HyperVAdminsSid) was not found." }
  return $group
}

function Test-AccountMembership([string]$User, $Group) {
  $members = @(Get-LocalGroupMember -Group $Group.Name -ErrorAction SilentlyContinue)
  return [bool]($members | Where-Object {
    $_.Name -ieq $User -or
    ($_.Name -split '\\')[-1] -ieq ($User -split '\\')[-1]
  } | Select-Object -First 1)
}

function Test-TokenMembership {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  return [bool]($identity.Groups | Where-Object { $_.Value -eq $HyperVAdminsSid } | Select-Object -First 1)
}

function Write-Result([hashtable]$Value) {
  $Value.at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $Value | ConvertTo-Json -Depth 5 | Set-Content -Path $ResultFile -Encoding UTF8
}

if (-not $TargetUser) { $TargetUser = Get-CurrentIdentityName }
$group = Get-HyperVGroup
$beforeMember = Test-AccountMembership $TargetUser $group
$currentTokenMember = Test-TokenMembership

if ($StatusOnly) {
  '=== MRD HYPER-V ACCESS ==='
  "Target account : $TargetUser"
  "Group          : $($group.Name) [$HyperVAdminsSid]"
  "Account member : $beforeMember"
  "Current token  : $currentTokenMember"
  if ($beforeMember -and -not $currentTokenMember) {
    'Next           : Sign out/in or reboot Windows so the new group membership enters the MRD logon token.'
  } elseif ($beforeMember -and $currentTokenMember) {
    'Next           : Access token is ready. Re-run Workspace Probe.'
  } else {
    'Next           : Run this script without -StatusOnly and approve the UAC prompt.'
  }
  exit 0
}

if (-not (Test-IsAdministrator)) {
  $escapedScript = '"' + $PSCommandPath.Replace('"','\"') + '"'
  $escapedUser = '"' + $TargetUser.Replace('"','\"') + '"'
  $args = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $escapedScript -TargetUser $escapedUser -Elevated"
  try {
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
    Write-Result @{
      state = 'uac-requested'
      targetUser = $TargetUser
      group = $group.Name
      accountMemberBefore = $beforeMember
      message = 'UAC elevation was requested on the Home PC.'
    }
    '=== MRD HYPER-V ACCESS ==='
    "Target account : $TargetUser"
    'State          : UAC requested'
    'Action         : Approve the Windows UAC prompt on HOME-PC.'
    'After approval : Run Hyper-V Access Status. A sign-out/reboot may still be required for the current token.'
    exit 0
  } catch {
    Write-Result @{
      state = 'uac-failed'
      targetUser = $TargetUser
      group = $group.Name
      error = $_.Exception.Message
    }
    throw
  }
}

if (-not $beforeMember) {
  Add-LocalGroupMember -Group $group.Name -Member $TargetUser -ErrorAction Stop
}

$afterMember = Test-AccountMembership $TargetUser $group
if (-not $afterMember) { throw "The account '$TargetUser' could not be verified in '$($group.Name)'." }

Write-Result @{
  state = 'membership-added'
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
