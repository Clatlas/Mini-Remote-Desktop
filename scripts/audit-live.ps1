[CmdletBinding()]
param(
    [switch]$Deep,
    [string]$BaseUrl = 'http://127.0.0.1:8787'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuntimeDir = Join-Path $Root '.runtime'
$ReportPath = Join-Path $RuntimeDir 'audit-report.json'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet('PASS','WARN','FAIL')][string]$Status,
        [string]$Detail,
        [bool]$Required = $true
    )
    $item = [pscustomobject]@{
        name = $Name
        status = $Status
        detail = $Detail
        required = $Required
    }
    $results.Add($item) | Out-Null
    $color = if ($Status -eq 'PASS') { 'Green' } elseif ($Status -eq 'WARN') { 'Yellow' } else { 'Red' }
    Write-Host ("[{0}] {1} - {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
}

function Try-Json {
    param([string]$Url, [string]$Method = 'GET', [object]$Body = $null)
    try {
        $params = @{
            Uri = $Url
            Method = $Method
            TimeoutSec = 8
            UseBasicParsing = $true
            ErrorAction = 'Stop'
        }
        if ($null -ne $Body) {
            $params.ContentType = 'application/json'
            $params.Body = ($Body | ConvertTo-Json -Compress)
        }
        return Invoke-RestMethod @params
    }
    catch {
        return $null
    }
}

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path $_) }
    return $candidates | Select-Object -First 1
}

function Find-Ffmpeg {
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
    if (Test-Path $link) { return $link }
    return $null
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Write-Host "`nMini Remote Desktop - HOME-PC Live Audit" -ForegroundColor Cyan
Write-Host ("Mode: {0}" -f $(if ($Deep) { 'DEEP (starts/stops Browser + Secret transport where available)' } else { 'READ-ONLY' })) -ForegroundColor DarkGray
Write-Host "Root: $Root`n" -ForegroundColor DarkGray

# Repository / runtime prerequisites
try {
    $package = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    Add-Result 'MRD package' 'PASS' ("v{0}" -f $package.version)
}
catch { Add-Result 'MRD package' 'FAIL' $_.Exception.Message }

try {
    $commit = (& git rev-parse --short=12 HEAD 2>$null | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -eq 0 -and $commit) { Add-Result 'Git checkout' 'PASS' $commit }
    else { Add-Result 'Git checkout' 'FAIL' 'Could not resolve current commit.' }
}
catch { Add-Result 'Git checkout' 'FAIL' $_.Exception.Message }

try {
    $nodeVersion = (& node --version 2>$null | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -eq 0 -and $nodeVersion) { Add-Result 'Node.js' 'PASS' $nodeVersion }
    else { Add-Result 'Node.js' 'FAIL' 'node.exe is unavailable.' }
}
catch { Add-Result 'Node.js' 'FAIL' $_.Exception.Message }

# MRD listener and API
try {
    $listeners = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop)
    $pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($pids.Count -eq 1) { Add-Result 'MRD listener' 'PASS' ("exactly one listener (PID {0})" -f $pids[0]) }
    elseif ($pids.Count -eq 0) { Add-Result 'MRD listener' 'FAIL' 'No listener on 127.0.0.1:8787.' }
    else { Add-Result 'MRD listener' 'FAIL' ("multiple listener PIDs: {0}" -f ($pids -join ', ')) }
}
catch { Add-Result 'MRD listener' 'FAIL' $_.Exception.Message }

$status = Try-Json "$BaseUrl/api/status"
if ($status) {
    Add-Result 'MRD status API' 'PASS' ("{0}; CPU {1}%; RAM {2}%; GPU {3}%" -f $status.state, $status.metrics.cpuPercent, $status.metrics.memoryPercent, $status.metrics.gpuPercent)
} else { Add-Result 'MRD status API' 'FAIL' 'GET /api/status failed.' }

$config = Try-Json "$BaseUrl/api/config"
if ($config) {
    Add-Result 'MRD config API' 'PASS' ("v{0}; PC {1}" -f $config.version, $config.pcName)
} else { Add-Result 'MRD config API' 'FAIL' 'GET /api/config failed.' }

$audio = Try-Json "$BaseUrl/api/audio"
if ($audio) {
    Add-Result 'Audio policy API' 'PASS' ("desktop={0}; browser={1}; active={2}; helper={3}" -f $audio.desktopMode, $audio.browserMode, $audio.activeMode, $audio.router.helperAvailable)
} else { Add-Result 'Audio policy API' 'FAIL' 'GET /api/audio failed.' }

$apps = Try-Json "$BaseUrl/api/apps"
if ($apps -and $apps.apps) {
    $ids = @($apps.apps | ForEach-Object { $_.id })
    $requiredApps = @('chrome','explorer','terminal','task-manager','settings','github-desktop','steam','photos','aura','services','mrd-admin')
    $missing = @($requiredApps | Where-Object { $_ -notin $ids })
    if ($missing.Count -eq 0) { Add-Result 'App catalog' 'PASS' ("{0} pinned apps; all MRD defaults present" -f $ids.Count) }
    else { Add-Result 'App catalog' 'FAIL' ("Missing defaults: {0}" -f ($missing -join ', ')) }
} else { Add-Result 'App catalog' 'FAIL' 'GET /api/apps failed or returned no apps.' }

# Docker / Guacamole
try {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { Add-Result 'Docker engine' 'PASS' 'Docker daemon is reachable.' }
    else { Add-Result 'Docker engine' 'FAIL' ("docker info exit code {0}" -f $LASTEXITCODE) }
}
catch { Add-Result 'Docker engine' 'FAIL' $_.Exception.Message }

try {
    $guac = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/guacamole/' -TimeoutSec 8
    if ($guac.StatusCode -ge 200 -and $guac.StatusCode -lt 500) { Add-Result 'Guacamole HTTP' 'PASS' ("HTTP {0}" -f $guac.StatusCode) }
    else { Add-Result 'Guacamole HTTP' 'FAIL' ("HTTP {0}" -f $guac.StatusCode) }
}
catch { Add-Result 'Guacamole HTTP' 'FAIL' $_.Exception.Message }

try {
    $dockerEnv = Join-Path $Root 'docker\.env'
    $compose = Join-Path $Root 'docker\compose.guacamole.yml'
    $services = @(& docker compose --env-file $dockerEnv -f $compose ps --status running --services 2>$null)
    $expected = @('postgres','guacd','guacamole')
    $missing = @($expected | Where-Object { $_ -notin $services })
    if ($missing.Count -eq 0) { Add-Result 'Guacamole containers' 'PASS' ($services -join ', ') }
    else { Add-Result 'Guacamole containers' 'FAIL' ("Missing running services: {0}" -f ($missing -join ', ')) }
}
catch { Add-Result 'Guacamole containers' 'FAIL' $_.Exception.Message }

# RDP / Not Secret
try {
    $term = Get-Service TermService -ErrorAction Stop
    $listen = @(Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue)
    if ($term.Status -eq 'Running' -and $listen.Count -gt 0) { Add-Result 'RDP / Not Secret' 'PASS' 'TermService running; TCP 3389 listening locally.' }
    else { Add-Result 'RDP / Not Secret' 'FAIL' ("TermService={0}; listener={1}" -f $term.Status, [bool]$listen.Count) }
}
catch { Add-Result 'RDP / Not Secret' 'FAIL' $_.Exception.Message }

# Tailscale private publication
try {
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) {
        $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
        if (Test-Path $candidate) { $tailscalePath = $candidate }
    } else { $tailscalePath = $tailscale.Source }
    if (-not $tailscalePath) { throw 'tailscale.exe not found.' }
    & $tailscalePath status *> $null
    if ($LASTEXITCODE -ne 0) { throw "tailscale status exit code $LASTEXITCODE" }
    $serve = (& $tailscalePath serve status 2>&1 | Out-String).Trim()
    if ($serve -match '8787') { Add-Result 'Tailscale Serve' 'PASS' 'Private Serve mapping includes MRD port 8787.' }
    else { Add-Result 'Tailscale Serve' 'WARN' 'Tailscale is connected, but Serve output did not clearly contain port 8787.' $false }
}
catch { Add-Result 'Tailscale Serve' 'FAIL' $_.Exception.Message }

# Native audio helper
$audioHelper = Join-Path $Root 'bin\mrd-audio-router.exe'
if (Test-Path $audioHelper) {
    try {
        $mute = (& $audioHelper get-mute 2>$null | Select-Object -First 1).Trim()
        if ($LASTEXITCODE -eq 0 -and $mute -in @('0','1')) { Add-Result 'MRD Audio Router' 'PASS' ("helper healthy; current endpoint mute={0}" -f $mute) }
        else { Add-Result 'MRD Audio Router' 'FAIL' 'Helper exists but get-mute self-test failed.' }
    }
    catch { Add-Result 'MRD Audio Router' 'FAIL' $_.Exception.Message }
} else { Add-Result 'MRD Audio Router' 'WARN' 'Native audio helper is not installed.' $false }

# Browser Engine prerequisites and optional deep start/stop
$chrome = Find-Chrome
if ($chrome) { Add-Result 'Google Chrome' 'PASS' $chrome }
else { Add-Result 'Google Chrome' 'FAIL' 'Chrome executable was not found.' }

$browserStatus = Try-Json "$BaseUrl/api/browser/status"
if ($browserStatus -and $browserStatus.chromeAvailable) {
    Add-Result 'Browser Engine status' 'PASS' ("phase={0}; Chrome available" -f $browserStatus.phase)
} else { Add-Result 'Browser Engine status' 'FAIL' 'Browser Engine does not report Chrome available.' }

if ($Deep -and $browserStatus -and $browserStatus.chromeAvailable) {
    $browserStart = Try-Json "$BaseUrl/api/browser/session" 'POST' @{}
    if ($browserStart -and $browserStart.ok) {
        Add-Result 'Browser Engine deep start' 'PASS' ("transport={0}" -f $browserStart.transport)
        $null = Try-Json "$BaseUrl/api/browser/stop" 'POST' @{}
    } else { Add-Result 'Browser Engine deep start' 'FAIL' 'POST /api/browser/session failed.' }
}

# Secret prerequisites and optional deep start/stop
$ffmpeg = Find-Ffmpeg
if ($ffmpeg) { Add-Result 'Secret FFmpeg' 'PASS' $ffmpeg $false }
else { Add-Result 'Secret FFmpeg' 'WARN' 'ffmpeg.exe not found; Secret setup is incomplete.' $false }

$secret = Try-Json "$BaseUrl/api/secret/status"
if ($secret -and $secret.ready) {
    Add-Result 'Secret transport status' 'PASS' ("{0}x{1}; FFmpeg={2}" -f $secret.display.width, $secret.display.height, $secret.ffmpegAvailable)
} elseif ($secret) {
    Add-Result 'Secret transport status' 'WARN' ($secret.error | Out-String).Trim() $false
} else { Add-Result 'Secret transport status' 'WARN' 'GET /api/secret/status failed.' $false }

if ($Deep -and $secret -and $secret.ready) {
    $sessionBefore = Try-Json "$BaseUrl/api/session"
    $secretStart = Try-Json "$BaseUrl/api/session/prepare" 'POST' @{ privacyMode = 'secret' }
    if ($secretStart -and $secretStart.ok -and $secretStart.transport -eq 'secret') {
        Add-Result 'Secret transport deep start' 'PASS' 'Capture/input worker started without forcing RDP.'
        $null = Try-Json "$BaseUrl/api/secret/stop" 'POST' @{}
        if ($sessionBefore -and $sessionBefore.privacyMode -eq 'not-secret') {
            $null = Try-Json "$BaseUrl/api/session/prepare" 'POST' @{ privacyMode = 'not-secret' }
        }
    } else { Add-Result 'Secret transport deep start' 'FAIL' 'Secret session prepare failed even though status reported ready.' }
}

# Static/server smoke suite from this checkout (uses a separate localhost port).
try {
    $checkOutput = (& npm run check 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0) { Add-Result 'Repository automated checks' 'PASS' 'Syntax + static wiring + isolated server smoke passed.' }
    else { Add-Result 'Repository automated checks' 'FAIL' (($checkOutput -split "`r?`n" | Select-Object -Last 8) -join ' | ') }
}
catch { Add-Result 'Repository automated checks' 'FAIL' $_.Exception.Message }

$failedRequired = @($results | Where-Object { $_.status -eq 'FAIL' -and $_.required }).Count
$warnings = @($results | Where-Object { $_.status -eq 'WARN' }).Count
$passed = @($results | Where-Object { $_.status -eq 'PASS' }).Count
$report = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    machine = $env:COMPUTERNAME
    deep = [bool]$Deep
    summary = [ordered]@{
        pass = $passed
        warn = $warnings
        failRequired = $failedRequired
    }
    results = $results
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host "`nAudit summary: $passed PASS / $warnings WARN / $failedRequired REQUIRED FAIL" -ForegroundColor $(if ($failedRequired) { 'Red' } elseif ($warnings) { 'Yellow' } else { 'Green' })
Write-Host "Report: $ReportPath" -ForegroundColor DarkGray

if ($failedRequired -gt 0) { exit 1 }
exit 0
