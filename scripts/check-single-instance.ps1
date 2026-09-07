$ErrorActionPreference = 'Stop'

$port = 8787
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$listenerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)

if ($listenerPids.Count -gt 1) {
    throw "Multiple active MRD listeners were found on port ${port}: $($listenerPids -join ', ')"
}

if ($listenerPids.Count -eq 1) {
    $listenerPid = $listenerPids[0]
    try {
        $process = Get-Process -Id $listenerPid -ErrorAction Stop
        Write-Host "MRD active listener: exactly 1 (PID $listenerPid, $($process.ProcessName))" -ForegroundColor Green
    } catch {
        Write-Host "MRD active listener: exactly 1 (PID $listenerPid)" -ForegroundColor Green
    }
} else {
    Write-Host 'MRD active listener: 0' -ForegroundColor DarkGray
}
