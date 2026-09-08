$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DockerEnv = Join-Path $Root 'docker\.env'
$ComposeFile = Join-Path $Root 'docker\compose.guacamole.yml'
$RuntimeDir = Join-Path $Root '.runtime'
$ConnectionIdFile = Join-Path $RuntimeDir 'guacamole-connection-id.txt'
$ConnectionName = 'MRD Desktop'

if (-not (Test-Path $DockerEnv) -or -not (Test-Path $ComposeFile)) {
    Write-Host 'Guacamole is not initialized yet; skipping MRD Desktop tuning.' -ForegroundColor DarkGray
    exit 0
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$connectionId = & docker compose --env-file $DockerEnv -f $ComposeFile exec -T postgres `
    psql -U guacamole_user -d guacamole_db -Atc "SELECT connection_id FROM guacamole_connection WHERE connection_name = '$ConnectionName' ORDER BY connection_id LIMIT 1;"
if ($LASTEXITCODE -ne 0) {
    throw 'Could not query the Guacamole connection database.'
}

$connectionId = ($connectionId | Select-Object -Last 1).Trim()
if (-not $connectionId) {
    Write-Host "Guacamole connection '$ConnectionName' does not exist yet; skipping mobile tuning." -ForegroundColor DarkGray
    Remove-Item $ConnectionIdFile -ErrorAction SilentlyContinue
    exit 0
}

# connection_id comes directly from PostgreSQL, but validate it before embedding
# it into the tuning SQL so this script never interpolates arbitrary text.
if ($connectionId -notmatch '^\d+$') {
    throw "Unexpected Guacamole connection ID: $connectionId"
}

# PostgreSQL CTEs are scoped to a single statement. Keep the tuning atomic and
# use the already-resolved numeric connection ID for both statements rather than
# trying to reuse a CTE from the INSERT in the following DELETE.
$sql = @"
BEGIN;

WITH desired(parameter_name, parameter_value) AS (
    VALUES
        ('enable-touch', 'true'),
        ('resize-method', 'display-update'),
        ('disable-gfx', 'false'),
        ('color-depth', '24'),
        ('disable-audio', 'false'),
        ('enable-audio-input', 'false'),
        ('console', 'false'),
        ('enable-wallpaper', 'false'),
        ('enable-full-window-drag', 'false'),
        ('enable-menu-animations', 'false')
)
INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
SELECT $connectionId, desired.parameter_name, desired.parameter_value
FROM desired
ON CONFLICT (connection_id, parameter_name)
DO UPDATE SET parameter_value = EXCLUDED.parameter_value;

-- Let Guacamole negotiate a single virtual RDP display from the current phone
-- viewport instead of preserving an old fixed desktop/monitor size.
DELETE FROM guacamole_connection_parameter
WHERE connection_id = $connectionId
  AND parameter_name IN ('width', 'height');

COMMIT;
"@

$sql | & docker compose --env-file $DockerEnv -f $ComposeFile exec -T postgres `
    psql -U guacamole_user -d guacamole_db -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw 'Could not apply MRD Desktop mobile/touch settings to Guacamole.'
}

Set-Content -Path $ConnectionIdFile -Value $connectionId -Encoding ASCII
Write-Host 'MRD Desktop: direct touch, dynamic single-display RDP, GFX acceleration, and RDP audio enabled.' -ForegroundColor Green
Write-Host "MRD Desktop direct connection ID: $connectionId" -ForegroundColor DarkGray
