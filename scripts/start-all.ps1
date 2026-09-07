$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DockerEnv = Join-Path $Root 'docker\.env'
$ComposeFile = Join-Path $Root 'docker\compose.guacamole.yml'
$GuacSetup = Join-Path $Root 'scripts\setup-guacamole.ps1'
$RuntimeDir = Join-Path $Root '.runtime'
$PidFile = Join-Path $RuntimeDir 'mrd-host.pid'
$StdoutLog = Join-Path $RuntimeDir 'mrd-host.log'
$StderrLog = Join-Path $RuntimeDir 'mrd-host-error.log'
$EnvFile = Join-Path $Root '.env'
$EnvExample = Join-Path $Root '.env.example'

Set-Location $Root
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-Http([string]$Url) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureMessage) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw $FailureMessage
}

Write-Host 'Mini Remote Desktop - Starting complete stack' -ForegroundColor Green

# 1. Docker Desktop / Linux engine
Write-Step 'Checking Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI is not installed. Install Docker Desktop first.'
}

$dockerReady = $false
try {
    docker info *> $null
    $dockerReady = ($LASTEXITCODE -eq 0)
} catch {
    $dockerReady = $false
}

if (-not $dockerReady) {
    $dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $dockerDesktop)) {
        throw 'Docker Desktop is installed incorrectly or cannot be found.'
    }

    Write-Host 'Docker engine is not running. Starting Docker Desktop...'
    $runningDockerUi = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
    if (-not $runningDockerUi) {
        Start-Process $dockerDesktop | Out-Null
    }

    Wait-Until -TimeoutSeconds 120 -FailureMessage 'Docker Desktop did not become ready within 120 seconds.' -Condition {
        try {
            docker info *> $null
            return ($LASTEXITCODE -eq 0)
        } catch {
            return $false
        }
    }
}
Write-Host 'Docker Desktop: ready' -ForegroundColor Green

# 2. Guacamole stack
Write-Step 'Starting Guacamole gateway'
if ((Test-Path $DockerEnv) -and (Test-Path (Join-Path $Root 'docker\initdb.sql'))) {
    & docker compose --env-file $DockerEnv -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) { throw 'Guacamole Docker stack failed to start.' }
} else {
    Write-Host 'Guacamole has not been initialized yet. Running first-time setup...'
    & $GuacSetup
}

Wait-Until -TimeoutSeconds 60 -FailureMessage 'Guacamole did not become reachable on 127.0.0.1:8080.' -Condition {
    Test-Http 'http://127.0.0.1:8080/guacamole/'
}
Write-Host 'Guacamole: ready' -ForegroundColor Green

# 3. MRD Node host
Write-Step 'Starting MRD host'
if (-not (Test-Path $EnvFile)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host 'Created .env from .env.example.'
}

if (-not (Test-Path (Join-Path $Root 'node_modules\ws'))) {
    Write-Host 'Installing MRD Node dependencies...'
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}

if (Test-Http 'http://127.0.0.1:8787/api/status') {
    Write-Host 'MRD host: already running' -ForegroundColor Green
} else {
    $node = (Get-Command node -ErrorAction Stop).Source

    Remove-Item $StdoutLog -ErrorAction SilentlyContinue
    Remove-Item $StderrLog -ErrorAction SilentlyContinue

    $process = Start-Process -FilePath $node `
        -ArgumentList 'src\server.mjs' `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $PidFile -Value $process.Id -Encoding ASCII

    try {
        Wait-Until -TimeoutSeconds 30 -FailureMessage "MRD host did not become reachable. Check $StderrLog" -Condition {
            Test-Http 'http://127.0.0.1:8787/api/status'
        }
    } catch {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        throw
    }

    Write-Host "MRD host: ready (PID $($process.Id))" -ForegroundColor Green
}

# 4. Tailscale private HTTPS publishing
Write-Step 'Publishing MRD through Tailscale'
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
    $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path $candidate) {
        $Tailscale = $candidate
    } else {
        throw 'Tailscale CLI not found.'
    }
} else {
    $Tailscale = (Get-Command tailscale).Source
}

$tailscaleReady = $false
for ($i = 0; $i -lt 15; $i++) {
    & $Tailscale status *> $null
    if ($LASTEXITCODE -eq 0) {
        $tailscaleReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $tailscaleReady) {
    throw 'Tailscale is not connected. Open Tailscale and connect this PC to the tailnet.'
}

& $Tailscale serve --bg localhost:8787
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve could not publish MRD.' }

Write-Host ''
& $Tailscale serve status

# Final verification
Write-Step 'MRD startup complete'
Write-Host 'MRD host:        http://127.0.0.1:8787' -ForegroundColor Green
Write-Host 'Guacamole:      http://127.0.0.1:8080/guacamole/' -ForegroundColor Green
Write-Host 'Private mobile: use the HTTPS .ts.net URL shown above' -ForegroundColor Green
Write-Host ''
Write-Host "Host logs: $StdoutLog" -ForegroundColor DarkGray
Write-Host "Host errors: $StderrLog" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'You can close this window. MRD will keep running.' -ForegroundColor Yellow
