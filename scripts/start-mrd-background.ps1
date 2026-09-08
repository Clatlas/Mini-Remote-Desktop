$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root '.runtime'
$Launcher = Join-Path $Root 'Start-MRD.cmd'
$Log = Join-Path $Runtime 'mrd-autostart.log'

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Write-AutostartLog([string]$Message) {
  $stamp = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz')
  Add-Content -Path $Log -Value "[$stamp] $Message" -Encoding UTF8
}

try {
  Write-AutostartLog "Logon launcher started as $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)."

  # Give Explorer, Docker Desktop and the user session a short head start after logon.
  Start-Sleep -Seconds 8

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/status' -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-AutostartLog 'MRD is already reachable; no startup action required.'
      exit 0
    }
  } catch {}

  if (-not (Test-Path $Launcher)) {
    throw "Start-MRD.cmd was not found at $Launcher"
  }

  $env:MRD_NONINTERACTIVE = '1'
  $env:MRD_RESTART_DETACHED = '1'

  Write-AutostartLog 'Starting MRD stack.'
  $output = & cmd.exe /d /c "`"$Launcher`"" 2>&1
  foreach ($line in @($output)) {
    if ($null -ne $line) { Add-Content -Path $Log -Value ([string]$line) -Encoding UTF8 }
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Start-MRD.cmd exited with code $LASTEXITCODE"
  }

  $ready = $false
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/status' -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  if (-not $ready) { throw 'MRD did not become reachable after logon startup.' }
  Write-AutostartLog 'MRD logon startup completed successfully.'
  exit 0
} catch {
  Write-AutostartLog "FAILED: $($_.Exception.Message)"
  try { Add-Content -Path $Log -Value $_.Exception.ToString() -Encoding UTF8 } catch {}
  exit 1
}
