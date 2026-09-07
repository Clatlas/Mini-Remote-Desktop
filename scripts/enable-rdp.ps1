# Run from an elevated PowerShell window.
$ErrorActionPreference = 'Stop'
$edition = (Get-ComputerInfo -Property WindowsProductName).WindowsProductName
Write-Host "Detected: $edition"
if ($edition -notmatch 'Pro|Enterprise|Education') {
    throw 'This Windows edition cannot host Microsoft RDP.'
}

Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'
Write-Host 'Remote Desktop host enabled and Windows Firewall rules enabled.' -ForegroundColor Green
Write-Host 'Confirm Settings > System > Remote Desktop also reports On.' -ForegroundColor Cyan
