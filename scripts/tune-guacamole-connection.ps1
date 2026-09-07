$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DockerEnv = Join-Path $Root 'docker\.env'
$ComposeFile = Join-Path $Root 'docker\compose.guacamole.yml'
$ConnectionName = 'MRD Desktop'

if (-not (Test-Path $DockerEnv) -or -not (Test-Path $ComposeFile)) {
    Write-Host 'Guacamole is not initialized yet; skipping MRD Desktop tuning.' -ForegroundColor DarkGray
    exit 0
}

$count = & docker compose --env-file $DockerEnv -f $ComposeFile exec -T postgres `
    psql -U guacamole_user -d guacamole_db -Atc "SELECT COUNT(*) FROM guacamole_connection WHERE connection_name = '$ConnectionName';"
if ($LASTEXITCODE -ne 0) {
    throw 'Could not query the Guacamole connection database.'
}

$countValue = 0
[void][int]::TryParse(($count | Select-Object -Last 1).Trim(), [ref]$countValue)
if ($countValue -lt 1) {
    Write-Host "Guacamole connection '$ConnectionName' does not exist yet; skipping mobile tuning." -ForegroundColor DarkGray
    exit 0
}

$sql = @"
WITH target AS (
    SELECT connection_id
    FROM guacamole_connection
    WHERE connection_name = '$ConnectionName'
), desired(parameter_name, parameter_value) AS (
    VALUES
        ('enable-touch', 'true'),
        ('resize-method', 'display-update'),
        ('disable-gfx', 'true'),
        ('color-depth', '24'),
        ('disable-audio', 'false'),
        ('enable-audio-input', 'false')
)
INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
SELECT target.connection_id, desired.parameter_name, desired.parameter_value
FROM target CROSS JOIN desired
ON CONFLICT (connection_id, parameter_name)
DO UPDATE SET parameter_value = EXCLUDED.parameter_value;
"@

$sql | & docker compose --env-file $DockerEnv -f $ComposeFile exec -T postgres `
    psql -U guacamole_user -d guacamole_db -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw 'Could not apply MRD Desktop mobile/touch settings to Guacamole.'
}

Write-Host 'MRD Desktop: direct touch, dynamic resize, GFX compatibility, and RDP audio enabled.' -ForegroundColor Green
