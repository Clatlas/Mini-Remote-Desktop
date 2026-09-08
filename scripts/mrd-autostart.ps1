param(
  [ValidateSet('Install','Status','Remove')]
  [string]$Mode = 'Status'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$Startup = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $Startup 'Mini Remote Desktop.lnk'
$BackgroundScript = Join-Path $Root 'scripts\start-mrd-background.ps1'
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ExpectedArgs = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BackgroundScript`""

function Get-ShortcutInfo {
  if (-not (Test-Path $ShortcutPath)) {
    return [pscustomobject]@{ Installed = $false; Target = $null; Arguments = $null; Valid = $false }
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $valid = ($shortcut.TargetPath -ieq $PowerShell) -and ($shortcut.Arguments -eq $ExpectedArgs)
  return [pscustomobject]@{
    Installed = $true
    Target = $shortcut.TargetPath
    Arguments = $shortcut.Arguments
    WorkingDirectory = $shortcut.WorkingDirectory
    Valid = $valid
  }
}

if (-not (Test-Path $BackgroundScript)) {
  throw "MRD background launcher is missing: $BackgroundScript"
}

switch ($Mode) {
  'Install' {
    New-Item -ItemType Directory -Force -Path $Startup | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $PowerShell
    $shortcut.Arguments = $ExpectedArgs
    $shortcut.WorkingDirectory = $Root
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Start Mini Remote Desktop after HOME-PC user logon'
    $shortcut.Save()

    $info = Get-ShortcutInfo
    if (-not $info.Valid) { throw 'MRD autostart shortcut was created but did not verify correctly.' }

    '=== MRD AUTOSTART ==='
    "Account        : $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    'Installed      : True'
    'Trigger        : Windows user logon'
    "Shortcut       : $ShortcutPath"
    "Launcher       : $BackgroundScript"
    'Run context    : Interactive user token'
    'Next           : Safe to sign out/in. MRD will start automatically after the next logon.'
  }
  'Status' {
    $info = Get-ShortcutInfo
    '=== MRD AUTOSTART ==='
    "Account        : $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    "Installed      : $($info.Installed)"
    "Valid          : $($info.Valid)"
    'Trigger        : Windows user logon'
    "Shortcut       : $ShortcutPath"
    "Launcher       : $BackgroundScript"
    "Last log       : $(Join-Path $Root '.runtime\mrd-autostart.log')"
    if ($info.Installed -and -not $info.Valid) {
      'Next           : Run with -Mode Install to repair the shortcut.'
    } elseif ($info.Valid) {
      'Next           : Autostart is ready.'
    } else {
      'Next           : Run with -Mode Install.'
    }
  }
  'Remove' {
    Remove-Item -Path $ShortcutPath -Force -ErrorAction SilentlyContinue
    '=== MRD AUTOSTART ==='
    'Installed      : False'
    "Shortcut       : $ShortcutPath"
    'Next           : MRD will no longer start automatically at user logon.'
  }
}
