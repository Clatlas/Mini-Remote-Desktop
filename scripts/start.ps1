$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example.'
}

if (-not (Test-Path 'node_modules\ws')) {
  Write-Host 'Installing MRD Node dependencies...'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
}

node src\server.mjs
