import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let cache = { at: 0, value: { gpuPercent: null, gpuName: null } };
let pending = null;

export async function getGpuMetrics(force = false) {
  if (process.platform !== 'win32') return { gpuPercent: null, gpuName: null };
  const now = Date.now();
  if (!force && now - cache.at < 8000) return cache.value;
  if (pending) return pending;

  pending = queryGpu()
    .then(value => {
      cache = { at: Date.now(), value };
      return value;
    })
    .catch(() => cache.value)
    .finally(() => { pending = null; });
  return pending;
}

async function queryGpu() {
  const script = String.raw`
$controllers = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -and $_.Name -notmatch 'Microsoft Basic|Remote Display|Virtual Display' })
$gpuName = ($controllers | Select-Object -First 1 -ExpandProperty Name)
$util = $null
try {
  $samples = @(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples |
    Where-Object { $_.CookedValue -ge 0 -and $_.InstanceName -notmatch 'engtype_Copy' }
  if ($samples.Count) {
    $sum = ($samples | Measure-Object CookedValue -Sum).Sum
    $util = [math]::Round([math]::Min(100,[math]::Max(0,$sum)))
  }
} catch {}
[pscustomobject]@{ gpuName=$gpuName; gpuPercent=$util } | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script
  ], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
  const value = JSON.parse(stdout.trim() || '{}');
  return {
    gpuPercent: Number.isFinite(Number(value.gpuPercent)) ? Number(value.gpuPercent) : null,
    gpuName: value.gpuName ? String(value.gpuName) : null
  };
}
