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

function Test-ProcessAlive([int]$ProcessId) {
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Wait-ProcessExit([int]$ProcessId, [int]$Milliseconds = 1500) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
    do {
        if (-not (Test-ProcessAlive $ProcessId)) { return $true }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    return (-not (Test-ProcessAlive $ProcessId))
}

function Stop-MrdProcess([int]$ProcessId) {
    if (-not (Test-ProcessAlive $ProcessId)) { return }

    $stopError = $null
    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        $stopError = $_.Exception.Message
    }
    if (Wait-ProcessExit $ProcessId 1500) { return }

    $taskkillOutput = ''
    try {
        $taskkillOutput = (& taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-String).Trim()
    } catch {
        $taskkillOutput = $_.Exception.Message
    }
    if (Wait-ProcessExit $ProcessId 2000) { return }

    try {
        $record = Get-ProcessRecord $ProcessId
        if ($record) {
            Invoke-CimMethod -InputObject $record -MethodName Terminate -Arguments @{ Reason = 1 } -ErrorAction SilentlyContinue | Out-Null
        }
    } catch {}
    if (Wait-ProcessExit $ProcessId 1500) { return }

    $details = @()
    if ($stopError) { $details += "Stop-Process: $stopError" }
    if ($taskkillOutput) { $details += "taskkill: $taskkillOutput" }
    $suffix = if ($details.Count) { ' ' + ($details -join ' | ') } else { '' }
    throw "Could not terminate MRD host PID $ProcessId.$suffix If access was denied, run Start-MRD.cmd once from an elevated PowerShell window."
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
    $targetProcessId = [int]$target.ProcessId
    Write-Host "Stopping previous MRD host (PID $targetProcessId) so current code is loaded..." -ForegroundColor DarkGray
    Stop-MrdProcess $targetProcessId
}

if ($targets.Count) {
    $deadline = (Get-Date).AddSeconds(4)
    do {
        Start-Sleep -Milliseconds 200
        $remaining = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    if ($remaining.Count -gt 0) {
        $owners = ($remaining | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        throw "MRD port $Port is still in use after terminating the previous host (PID(s): $owners)."
    }
}

Remove-Item $PidFile -ErrorAction SilentlyContinue
exit 0
