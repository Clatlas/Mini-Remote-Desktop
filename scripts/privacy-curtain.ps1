[CmdletBinding()]
param(
    [ValidateSet('Start','Stop')]
    [string]$Mode = 'Start',
    [int]$TargetWidth = 880,
    [int]$TargetHeight = 1912,
    [string]$TargetDevice = '',
    [string]$RuntimeDir = 'B:\Mini-Remote-Desktop\.runtime',
    [string]$StatusUrl = 'http://127.0.0.1:8787/api/secret/status'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PidFile = Join-Path $RuntimeDir 'privacy-curtain.pid'

function Stop-ExistingCurtain {
    if (-not (Test-Path $PidFile)) { return }
    $savedPid = 0
    try { $savedPid = [int](Get-Content $PidFile -Raw).Trim() } catch {}
    if ($savedPid -gt 0 -and $savedPid -ne $PID) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
            if ($proc -and [string]$proc.CommandLine -match 'privacy-curtain\.ps1') {
                Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

if ($Mode -eq 'Stop') {
    Stop-ExistingCurtain
    Write-Output 'MRD privacy curtain stopped.'
    exit 0
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Stop-ExistingCurtain
Set-Content -Path $PidFile -Value $PID -Encoding Ascii

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Windows.Forms;

public class MrdPrivacyForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
            return cp;
        }
    }
}
'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing

$allScreens = @([System.Windows.Forms.Screen]::AllScreens)
$target = $null
if ($TargetDevice) {
    $target = $allScreens | Where-Object { $_.DeviceName -eq $TargetDevice } | Select-Object -First 1
}
if (-not $target) {
    $target = $allScreens |
        Where-Object { $_.Bounds.Width -eq $TargetWidth -and $_.Bounds.Height -eq $TargetHeight -and -not $_.Primary } |
        Select-Object -First 1
}
if (-not $target) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    throw "MRD virtual display ${TargetWidth}x${TargetHeight} was not found."
}

$physical = @($allScreens | Where-Object { $_.DeviceName -ne $target.DeviceName })
if (-not $physical.Count) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    throw 'No physical displays were found to cover.'
}

$forms = New-Object System.Collections.Generic.List[System.Windows.Forms.Form]
foreach ($screen in $physical) {
    $form = New-Object MrdPrivacyForm
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Bounds = $screen.Bounds
    $form.BackColor = [System.Drawing.Color]::Black
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.ControlBox = $false
    $form.MinimizeBox = $false
    $form.MaximizeBox = $false
    $form.Text = 'MRD Privacy Curtain'
    $form.Show()
    $form.TopMost = $true
    $forms.Add($form)
}

$script:missingStreamTicks = 0
$script:startupTicks = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
    $script:startupTicks += 1

    foreach ($form in $forms) {
        if ($form.IsDisposed) { continue }
        $form.TopMost = $true
        $form.BringToFront()
    }

    try {
        $status = Invoke-RestMethod -Uri $StatusUrl -Method Get -TimeoutSec 2
        $clients = [int]($status.videoClients)
        if ($clients -gt 0) {
            $script:missingStreamTicks = 0
        } elseif ($script:startupTicks -gt 20) {
            $script:missingStreamTicks += 1
        }
    } catch {
        if ($script:startupTicks -gt 10) { $script:missingStreamTicks += 1 }
    }

    # After the startup grace period, restore the physical displays if MRD has
    # no active VDD video client for ~4 seconds or the host becomes unreachable.
    if ($script:missingStreamTicks -ge 8) {
        $timer.Stop()
        foreach ($form in $forms) { try { $form.Close() } catch {} }
        [System.Windows.Forms.Application]::ExitThread()
    }
})

$timer.Start()
Write-Output "MRD_PRIVACY_CURTAIN_READY target=$($target.DeviceName) physical=$($physical.Count)"
try {
    [System.Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    foreach ($form in $forms) { try { $form.Close(); $form.Dispose() } catch {} }
    try {
        if ((Test-Path $PidFile) -and ([int](Get-Content $PidFile -Raw).Trim()) -eq $PID) {
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
