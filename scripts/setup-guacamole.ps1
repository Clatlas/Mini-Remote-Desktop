$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root 'docker\.env'
$ComposeFile = Join-Path $Root 'docker\compose.guacamole.yml'
$InitDb = Join-Path $Root 'docker\initdb.sql'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI not found. Install/start Docker Desktop first.'
}

docker version | Out-Null

if (-not (Test-Path $EnvFile)) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $password = [Convert]::ToBase64String($bytes).Replace('+','A').Replace('/','B').Replace('=','')
    "GUAC_DB_PASSWORD=$password" | Set-Content -Path $EnvFile -Encoding UTF8
    Write-Host 'Created a local Guacamole database secret.' -ForegroundColor Green
}

if (-not (Test-Path $InitDb)) {
    Write-Host 'Generating the Guacamole PostgreSQL schema...' -ForegroundColor Cyan
    $schema = docker run --rm guacamole/guacamole:1.6.0 /opt/guacamole/bin/initdb.sh --postgresql
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the Guacamole database schema.' }
    $schema | Set-Content -Path $InitDb -Encoding UTF8
}

Write-Host 'Starting Apache Guacamole 1.6.0 + guacd + PostgreSQL...' -ForegroundColor Cyan
docker compose --env-file $EnvFile -f $ComposeFile up -d

Write-Host ''
Write-Host 'Guacamole gateway is starting on http://127.0.0.1:8080/guacamole/' -ForegroundColor Green
Write-Host 'First login: guacadmin / guacadmin' -ForegroundColor Yellow
Write-Host 'Change that password immediately after first login.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Next: create an RDP connection pointing to host.docker.internal:3389.' -ForegroundColor Cyan
