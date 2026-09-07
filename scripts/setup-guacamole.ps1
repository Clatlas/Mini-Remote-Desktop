$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root 'docker\.env'
$ComposeFile = Join-Path $Root 'docker\compose.guacamole.yml'
$InitDb = Join-Path $Root 'docker\initdb.sql'

$DockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $DockerCommand) {
    throw 'Docker CLI not found. Install Docker Desktop, launch it, and wait for the Docker engine to report Running.'
}

# External command failures do not automatically honor $ErrorActionPreference in Windows PowerShell 5.1.
# Check Docker's exit code explicitly so setup never continues with a stopped engine.
& $DockerCommand.Source version *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker CLI is installed, but the Docker engine is not running. Open Docker Desktop and wait until it reports that the engine is running, then run this script again.'
}

if (-not (Test-Path $EnvFile)) {
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $password = [Convert]::ToBase64String($bytes).Replace('+','A').Replace('/','B').Replace('=','')
    "GUAC_DB_PASSWORD=$password" | Set-Content -Path $EnvFile -Encoding UTF8
    Write-Host 'Created a local Guacamole database secret.' -ForegroundColor Green
}

if (-not (Test-Path $InitDb)) {
    Write-Host 'Generating the Guacamole PostgreSQL schema...' -ForegroundColor Cyan
    $schema = & $DockerCommand.Source run --rm guacamole/guacamole:1.6.0 /opt/guacamole/bin/initdb.sh --postgresql
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the Guacamole database schema.' }
    $schema | Set-Content -Path $InitDb -Encoding UTF8
}

Write-Host 'Starting Apache Guacamole 1.6.0 + guacd + PostgreSQL...' -ForegroundColor Cyan
& $DockerCommand.Source compose --env-file $EnvFile -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not start the Guacamole stack.' }

Write-Host ''
Write-Host 'Guacamole gateway is starting on http://127.0.0.1:8080/guacamole/' -ForegroundColor Green
Write-Host 'First login: guacadmin / guacadmin' -ForegroundColor Yellow
Write-Host 'Change that password immediately after first login.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Next: create an RDP connection pointing to host.docker.internal:3389.' -ForegroundColor Cyan
