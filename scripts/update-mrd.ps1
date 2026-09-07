$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuntimeDir = Join-Path $Root '.runtime'
$LogPath = Join-Path $RuntimeDir 'update.log'
$ResultPath = Join-Path $Root 'public\update-result.json'
$Launcher = Join-Path $Root 'Start-MRD.cmd'

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Get-EpochMs {
    return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Write-UpdateResult(
    [string]$State,
    [string]$Message,
    [string]$Commit = '',
    [string]$Details = ''
) {
    $payload = [ordered]@{
        state = $State
        message = $Message
        at = Get-EpochMs
        commit = $Commit
        details = $Details
    } | ConvertTo-Json -Compress

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ResultPath, $payload, $utf8NoBom)
}

function Write-UpdateLog([string]$Message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $LogPath -Value "[$stamp] $Message"
}

Set-Location $Root
Write-UpdateResult -State 'running' -Message 'Checking GitHub for MRD updates.'
Write-UpdateLog 'Remote update requested.'

$pullSucceeded = $false
$pullError = ''
$before = ''
$commit = ''
$pullOutput = ''

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git is not available in PATH.'
    }

    $before = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    Write-UpdateLog "Current commit: $before"

    $pullLines = @(& git pull --ff-only 2>&1)
    $pullOutput = ($pullLines -join [Environment]::NewLine).Trim()
    $pullExit = $LASTEXITCODE
    Write-UpdateLog "git pull --ff-only exit code: $pullExit"
    if ($pullOutput) { Write-UpdateLog $pullOutput }

    if ($pullExit -ne 0) {
        throw "git pull --ff-only failed. $pullOutput"
    }

    $commit = (& git rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    $pullSucceeded = $true
    Write-UpdateResult -State 'restarting' -Message 'Update pulled. Restarting MRD with the current code.' -Commit $commit -Details $pullOutput
    Write-UpdateLog "Updated commit: $commit"
}
catch {
    $pullError = $_.Exception.Message
    if (-not $commit) { $commit = $before }
    Write-UpdateResult -State 'restarting' -Message 'GitHub update did not apply. Restarting the current MRD host to preserve remote access.' -Commit $commit -Details $pullError
    Write-UpdateLog "Update failed: $pullError"
}

# Always run the canonical launcher. If git pull failed, this safely restores the
# current MRD host. If it succeeded, this loads the newly-pulled backend/frontend.
if (-not (Test-Path $Launcher)) {
    Write-UpdateResult -State 'failed' -Message 'MRD update could not restart because Start-MRD.cmd was not found.' -Commit $commit -Details $pullError
    Write-UpdateLog 'Start-MRD.cmd was not found.'
    exit 1
}

try {
    $env:MRD_NONINTERACTIVE = '1'
    & cmd.exe /d /c "`"$Launcher`""
    $startExit = $LASTEXITCODE

    if ($startExit -ne 0) {
        throw "Start-MRD.cmd exited with code $startExit."
    }

    if ($pullSucceeded) {
        Write-UpdateResult -State 'success' -Message 'MRD updated and restarted successfully.' -Commit $commit -Details $pullOutput
        Write-UpdateLog 'MRD update and restart completed successfully.'
    }
    else {
        Write-UpdateResult -State 'failed' -Message 'MRD restarted, but the GitHub update did not apply.' -Commit $commit -Details $pullError
        Write-UpdateLog 'MRD restarted after failed pull.'
    }
}
catch {
    $detail = $_.Exception.Message
    Write-UpdateResult -State 'failed' -Message 'MRD update/restart failed.' -Commit $commit -Details $detail
    Write-UpdateLog "Restart failed: $detail"
    exit 1
}
