$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root '.runtime\mrd-host.pid'

function Get-MrdProcessById([int]$ProcessId) {
    try {
        $item = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
        if ($item -and $item.Name -match '^node(\.exe)?$' -and $item.CommandLine -match 'src[\\/]server\.mjs') {
            return $item
        }
    } catch {}
    return $null
}

$targets = @()
if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $processId = 0
    if ([int]::TryParse([string]$raw, [ref]$processId)) {
        $managed = Get-MrdProcessById $processId
        if ($managed) { $targets += $managed }
    }
}

# Recovery path for a stale/missing PID file. Only target Node processes whose
# command line explicitly runs MRD's src/server.mjs.
if (-not $targets.Count) {
    $targets = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'src[\\/]server\.mjs' })
}

foreach ($target in $targets) {
    Write-Host "Stopping previous MRD host (PID $($target.ProcessId)) so current code is loaded..." -ForegroundColor DarkGray
    Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}

if ($targets.Count) {
    $deadline = (Get-Date).AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        $listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
    } while ($listener -and (Get-Date) -lt $deadline)
}

Remove-Item $PidFile -ErrorAction SilentlyContinue
exit 0
