$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Launcher = Join-Path $Root 'Start-MRD.cmd'

function Test-MrdHostAncestor {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue
    $seen = @{}

    while ($current -and $current.ParentProcessId -gt 0 -and -not $seen.ContainsKey([int]$current.ParentProcessId)) {
        $parentId = [int]$current.ParentProcessId
        $seen[$parentId] = $true
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
        if (-not $parent) { break }

        if ($parent.Name -match '^node(\.exe)?$' -and [string]$parent.CommandLine -match 'server\.mjs') {
            return $true
        }

        $current = $parent
    }

    return $false
}

if ($env:MRD_RESTART_DETACHED -eq '1') {
    exit 0
}

if (-not (Test-MrdHostAncestor)) {
    exit 0
}

if (-not (Test-Path $Launcher)) {
    throw "MRD launcher was not found: $Launcher"
}

$escapedLauncher = $Launcher.Replace("'", "''")
$helper = @"
Start-Sleep -Seconds 2
`$env:MRD_RESTART_DETACHED = '1'
`$env:MRD_NONINTERACTIVE = '1'
& cmd.exe /d /c "`"$escapedLauncher`""
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))

Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) `
    -WindowStyle Hidden | Out-Null

Write-Host 'MRD restart handed off to an independent launcher. This connection will close briefly.' -ForegroundColor Yellow
exit 10
