[CmdletBinding()]
param(
    [int]$Width = 880,
    [int]$Height = 1912,
    [int]$RefreshRate = 60
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VddDir = 'C:\VirtualDisplayDriver'
$VddSettings = Join-Path $VddDir 'vdd_settings.xml'
$DriverUrl = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip'
$DriverSha256 = 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a'
$NefconUrl = 'https://github.com/nefarius/nefcon/releases/download/v1.14.0/nefcon_v1.14.0.zip'
$NefconSha256 = 'a15557da24a9efca203158de3b43b0eaf982db231f0194031f1ed428bc13e669'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Hash([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Path. Expected $Expected but received $actual."
    }
}

function Find-Ffmpeg {
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
    if (Test-Path $link) { return $link }
    return $null
}

function Get-SecretScreen {
    Add-Type -AssemblyName System.Windows.Forms
    return [System.Windows.Forms.Screen]::AllScreens |
        Where-Object { $_.Bounds.Width -eq $Width -and $_.Bounds.Height -eq $Height } |
        Select-Object -First 1
}

if (-not (Test-Administrator)) {
    throw 'Secret transport setup must be run from PowerShell as Administrator.'
}

Write-Host "`nMini Remote Desktop - Secret Transport Setup" -ForegroundColor Cyan
Write-Host "Target virtual workspace: ${Width}x${Height} @ ${RefreshRate} Hz" -ForegroundColor DarkGray

# FFmpeg supplies the first Secret V1 low-latency display capture path.
$ffmpeg = Find-Ffmpeg
if (-not $ffmpeg) {
    Write-Host "`n==> Installing FFmpeg with Windows Package Manager" -ForegroundColor Cyan
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'winget.exe was not found. Install App Installer / Windows Package Manager and rerun this script.'
    }
    & winget.exe install --id Gyan.FFmpeg --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg installation failed with exit code $LASTEXITCODE." }
    $env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:PATH"
    $ffmpeg = Find-Ffmpeg
    if (-not $ffmpeg) { throw 'FFmpeg installed but ffmpeg.exe could not be located. Sign out/restart Windows and rerun setup.' }
}
Write-Host "FFmpeg: $ffmpeg" -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $VddDir | Out-Null

# Configure the signed VirtualDrivers VDD as one portrait monitor matching the
# iPhone 17 Pro Max MRD workspace. MRD streams it at 440x956 while Windows works
# at 880x1912 for materially better rendering detail.
$settings = @"
<?xml version='1.0' encoding='utf-8'?>
<vdd_settings>
  <monitors><count>1</count></monitors>
  <gpu><friendlyname>default</friendlyname></gpu>
  <global><g_refresh_rate>$RefreshRate</g_refresh_rate></global>
  <resolutions>
    <resolution>
      <width>$Width</width>
      <height>$Height</height>
      <refresh_rate>$RefreshRate</refresh_rate>
    </resolution>
  </resolutions>
  <logging>
    <SendLogsThroughPipe>true</SendLogsThroughPipe>
    <logging>false</logging>
    <debuglogging>false</debuglogging>
  </logging>
  <colour>
    <SDR10bit>false</SDR10bit>
    <HDRPlus>false</HDRPlus>
    <ColourFormat>RGB</ColourFormat>
  </colour>
  <cursor>
    <HardwareCursor>true</HardwareCursor>
    <CursorMaxX>128</CursorMaxX>
    <CursorMaxY>128</CursorMaxY>
    <AlphaCursorSupport>true</AlphaCursorSupport>
    <XorCursorSupportLevel>2</XorCursorSupportLevel>
  </cursor>
  <edid><CustomEdid>false</CustomEdid><PreventSpoof>false</PreventSpoof></edid>
  <auto_resolutions>
    <enabled>false</enabled>
    <source_priority>manual</source_priority>
    <preferred_mode>
      <use_edid_preferred>false</use_edid_preferred>
      <fallback_width>$Width</fallback_width>
      <fallback_height>$Height</fallback_height>
      <fallback_refresh>$RefreshRate</fallback_refresh>
    </preferred_mode>
  </auto_resolutions>
</vdd_settings>
"@

[System.IO.File]::WriteAllText($VddSettings, $settings, (New-Object System.Text.UTF8Encoding($false)))
New-Item -Path 'HKLM:\SOFTWARE\MikeTheTech' -Force | Out-Null
New-Item -Path 'HKLM:\SOFTWARE\MikeTheTech\VirtualDisplayDriver' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\MikeTheTech\VirtualDisplayDriver' -Name 'VDDPATH' -Value $VddDir -Type String
Write-Host "VDD configuration: $VddSettings" -ForegroundColor Green

$device = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.InstanceId -like 'ROOT\MTTVDD*' -or $_.FriendlyName -match 'Virtual Display Driver' } |
    Select-Object -First 1

if (-not $device) {
    Write-Host "`n==> Installing signed Virtual Display Driver" -ForegroundColor Cyan
    Write-Host 'Source: VirtualDrivers/Virtual-Display-Driver 25.7.23' -ForegroundColor DarkGray

    $temp = Join-Path $env:TEMP 'MRD-SecretTransport'
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $temp | Out-Null

    $driverZip = Join-Path $temp 'vdd.zip'
    $nefconZip = Join-Path $temp 'nefcon.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $DriverUrl -OutFile $driverZip
    Invoke-WebRequest -UseBasicParsing -Uri $NefconUrl -OutFile $nefconZip
    Assert-Hash $driverZip $DriverSha256
    Assert-Hash $nefconZip $NefconSha256

    Expand-Archive -Path $driverZip -DestinationPath $temp -Force
    Expand-Archive -Path $nefconZip -DestinationPath (Join-Path $temp 'nefcon') -Force

    $inf = Join-Path $temp 'VirtualDisplayDriver\MttVDD.inf'
    $cat = Join-Path $temp 'VirtualDisplayDriver\mttvdd.cat'
    $nefcon = Join-Path $temp 'nefcon\x64\nefconw.exe'
    if (-not (Test-Path $inf) -or -not (Test-Path $cat) -or -not (Test-Path $nefcon)) {
        throw 'Expected VDD/NefCon installer files were not found after extraction.'
    }

    $catalogSignature = Get-AuthenticodeSignature -FilePath $cat
    if ($catalogSignature.Status -ne 'Valid') {
        throw "Virtual Display Driver catalog signature is not valid: $($catalogSignature.Status)."
    }

    $certificates = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
    $certificates.Import([System.IO.File]::ReadAllBytes($cat))
    foreach ($cert in $certificates) {
        $certPath = Join-Path $temp "$($cert.Thumbprint).cer"
        [System.IO.File]::WriteAllBytes($certPath, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        Import-Certificate -FilePath $certPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null
    }

    Push-Location $temp
    try {
        & $nefcon install '.\VirtualDisplayDriver\MttVDD.inf' 'Root\MttVDD'
        if ($LASTEXITCODE -ne 0) { throw "NefCon VDD installation failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }

    Start-Sleep -Seconds 8
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue

    $device = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like 'ROOT\MTTVDD*' -or $_.FriendlyName -match 'Virtual Display Driver' } |
        Select-Object -First 1
}

if ($device) {
    Write-Host "Virtual Display Driver: $($device.Status) · $($device.InstanceId)" -ForegroundColor Green
    try {
        & pnputil.exe /restart-device "$($device.InstanceId)" | Out-Null
    } catch {
        Write-Host 'VDD device restart was not available; continuing.' -ForegroundColor Yellow
    }
}

# Ensure Windows is in extended-desktop mode so the VDD becomes its own workspace.
Start-Process "$env:WINDIR\System32\DisplaySwitch.exe" -ArgumentList '/extend' -WindowStyle Hidden -Wait
Start-Sleep -Seconds 5

$screen = Get-SecretScreen
if ($screen) {
    Write-Host "`nSecret virtual workspace detected: $($screen.DeviceName) at $($screen.Bounds.X),$($screen.Bounds.Y) · $($screen.Bounds.Width)x$($screen.Bounds.Height)" -ForegroundColor Green
    Write-Host 'Secret transport prerequisites are ready.' -ForegroundColor Green
} else {
    Write-Host "`nThe VDD is installed/configured, but Windows has not exposed the ${Width}x${Height} display yet." -ForegroundColor Yellow
    Write-Host 'Restart Windows once, then run this setup script again. The script is idempotent.' -ForegroundColor Yellow
}

Write-Host "`nRestart MRD after setup:" -ForegroundColor Cyan
Write-Host "  cd `"$Root`"" -ForegroundColor White
Write-Host '  .\Start-MRD.cmd' -ForegroundColor White
