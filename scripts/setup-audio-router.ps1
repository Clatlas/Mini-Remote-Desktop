param(
  [string]$ReleaseBase = "https://github.com/Clatlas/Mini-Remote-Desktop/releases/download/audio-router-latest"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "bin"
$exe = Join-Path $bin "mrd-audio-router.exe"
$checksumFile = Join-Path $bin "mrd-audio-router.exe.sha256"

New-Item -ItemType Directory -Force $bin | Out-Null

Write-Host "Downloading MRD Audio Router..."
Invoke-WebRequest "$ReleaseBase/mrd-audio-router.exe" -OutFile $exe
Invoke-WebRequest "$ReleaseBase/mrd-audio-router.exe.sha256" -OutFile $checksumFile

$expected = (Get-Content $checksumFile -Raw).Trim().ToLower()
$actual = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
  Remove-Item $exe -Force -ErrorAction SilentlyContinue
  throw "MRD Audio Router checksum mismatch. Expected $expected, got $actual."
}

Write-Host "Audio Router installed: $exe"
Write-Host "Testing Windows default output access..."
& $exe get-mute
if ($LASTEXITCODE -ne 0) { throw "Audio Router self-test failed." }

Write-Host "MRD Audio Router is ready. Restart MRD to enable live audio routing."
