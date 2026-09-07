$ErrorActionPreference = 'Stop'
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
    $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path $candidate) { $Tailscale = $candidate } else { throw 'Tailscale CLI not found.' }
} else {
    $Tailscale = (Get-Command tailscale).Source
}

Write-Host 'Publishing MRD privately to your tailnet...' -ForegroundColor Cyan
& $Tailscale serve --bg localhost:8787
Write-Host ''
& $Tailscale serve status
Write-Host ''
Write-Host 'Open the HTTPS URL shown above on your iPhone while Tailscale is connected.' -ForegroundColor Green
Write-Host 'Then Safari > Share > Add to Home Screen > Open as Web App.' -ForegroundColor Green
