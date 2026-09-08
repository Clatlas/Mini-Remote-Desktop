$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root '.runtime\mrd-host.pid'
$Port = 8787

function Get-ProcessRecord([int]$ProcessId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-MrdNode($ProcessRecord) {
    if (-not $ProcessRecord) { return $false }
    if ($ProcessRecord.Name -notmatch '^node(\.exe)?$') { return $false }
    return ([string]$ProcessRecord.CommandLine -match 'server\.mjs')
}

$targets = @{}

# Primary path: PID file written by start-all.ps1.
if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $processId = 0
    if ([int]::TryParse([string]$raw, [ref]$processId)) {
        $record = Get-ProcessRecord $processId
        if (Test-MrdNode $record) { $targets[$processId] = $record }
    }
}

# Recovery path for stale/missing PID files. Match any Node process running
# server.mjs rather than depending on how its src path was quoted/formatted.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { Test-MrdNode $_ } |
    ForEach-Object { $targets[[int]$_.ProcessId] = $_ }

# Final recovery path: port 8787 is reserved for MRD. If a Node process owns
# the listener, stop it even if its command line is unavailable/truncated.
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $ownerProcessId = [int]$listener.OwningProcess
    if ($targets.ContainsKey($ownerProcessId)) { continue }
    $record = Get-ProcessRecord $ownerProcessId
    if ($record -and $record.Name -match '^node(\.exe)?$') {
        $targets[$ownerProcessId] = $record
    }
}

foreach ($target in $targets.Values) {
    Write-Host "Stopping previous MRD host (PID $($target.ProcessId)) so current code is loaded..." -ForegroundColor DarkGray
    Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}

if ($targets.Count) {
    $deadline = (Get-Date).AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        $remaining = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    if ($remaining.Count -gt 0) {
        $owners = ($remaining | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        throw "MRD port $Port is still in use after the stop attempt (PID(s): $owners)."
    }
}

Remove-Item $PidFile -ErrorAction SilentlyContinue
exit 0
