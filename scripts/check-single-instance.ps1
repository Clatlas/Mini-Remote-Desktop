$ErrorActionPreference = 'Stop'

$port = 8787
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

if ($pids.Count -gt 1) {
    throw "Multiple active MRD listeners were found on port $port: $($pids -join ', ')"
}

if ($pids.Count -eq 1) {
    $pid = $pids[0]
    try {
        $process = Get-Process -Id $pid -ErrorAction Stop
        Write-Host "MRD active listener: exactly 1 (PID $pid, $($process.ProcessName))" -ForegroundColor Green
    } catch {
        Write-Host "MRD active listener: exactly 1 (PID $pid)" -ForegroundColor Green
    }
} else {
    Write-Host 'MRD active listener: 0' -ForegroundColor DarkGray
}
