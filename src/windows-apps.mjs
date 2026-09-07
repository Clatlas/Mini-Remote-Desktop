import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const APPS = [
  { id: 'chrome', name: 'Google Chrome', category: 'Internet', icon: '◎', description: 'Dedicated MRD Chrome window' },
  { id: 'explorer', name: 'File Explorer', category: 'Files', icon: '▣', description: 'Files, downloads, documents, and screenshots' },
  { id: 'terminal', name: 'Windows Terminal', category: 'Development', icon: '>_', description: 'Terminal with PowerShell fallback' },
  { id: 'task-manager', name: 'Task Manager', category: 'System', icon: '⌁', description: 'Processes, CPU, RAM, and GPU' },
  { id: 'settings', name: 'Settings', category: 'System', icon: '⚙', description: 'Windows Settings' },
  { id: 'github-desktop', name: 'GitHub Desktop', category: 'Development', icon: 'GH', description: 'Repositories, changes, and sync' },
  { id: 'steam', name: 'Steam', category: 'Gaming', icon: '◉', description: 'Library and download management' },
  { id: 'photos', name: 'Photos', category: 'Files', icon: '▧', description: 'Screenshots and images' },
  { id: 'aura', name: 'Aura', category: 'Security', icon: '◆', description: 'Scans and VPN' },
  { id: 'services', name: 'Services', category: 'System', icon: '≡', description: 'Windows service manager' },
  { id: 'mrd-admin', name: 'MRD Admin', category: 'MRD', icon: 'MRD', description: 'MRD, Docker, Guacamole, and Tailscale controls', kind: 'panel' }
];

const START_SCRIPTS = {
  chrome: String.raw`
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  ([IO.Path]::Combine([Environment]::GetFolderPath('ProgramFilesX86'), 'Google\Chrome\Application\chrome.exe')),
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }
$exe = $candidates | Select-Object -First 1
if (-not $exe) {
  $app = Get-StartApps | Where-Object { $_.Name -like '*Chrome*' } | Select-Object -First 1
  if (-not $app) { throw 'Google Chrome is not installed.' }
  Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\" + $app.AppID)
} else {
  Start-Process -FilePath $exe -ArgumentList '--new-window','https://www.google.com'
}
`,
  explorer: String.raw`Start-Process explorer.exe -ArgumentList "$env:USERPROFILE"`,
  terminal: String.raw`
if (Get-Command wt.exe -ErrorAction SilentlyContinue) { Start-Process wt.exe }
else { Start-Process powershell.exe }
`,
  'task-manager': String.raw`Start-Process taskmgr.exe`,
  settings: String.raw`Start-Process 'ms-settings:'`,
  'github-desktop': String.raw`
$exe = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\GitHubDesktop.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $exe) {
  $app = Get-StartApps | Where-Object { $_.Name -like '*GitHub Desktop*' } | Select-Object -First 1
  if (-not $app) { throw 'GitHub Desktop is not installed.' }
  Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\" + $app.AppID)
} else { Start-Process -FilePath $exe }
`,
  steam: String.raw`
$exe = $null
try { $exe = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamExe } catch {}
if (-not $exe -or -not (Test-Path $exe)) {
  $candidate = [IO.Path]::Combine([Environment]::GetFolderPath('ProgramFilesX86'), 'Steam\steam.exe')
  if (Test-Path $candidate) { $exe = $candidate }
}
if (-not $exe -or -not (Test-Path $exe)) { throw 'Steam is not installed.' }
Start-Process -FilePath $exe
`,
  photos: String.raw`
$app = Get-StartApps | Where-Object { $_.Name -match 'Photos' } | Select-Object -First 1
if (-not $app) { throw 'Microsoft Photos is not installed.' }
Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\" + $app.AppID)
`,
  aura: String.raw`
$app = Get-StartApps | Where-Object { $_.Name -match 'Aura' } | Select-Object -First 1
if (-not $app) { throw 'Aura was not found in the Windows app list.' }
Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\" + $app.AppID)
`,
  services: String.raw`Start-Process mmc.exe -ArgumentList 'services.msc'`
};

export function getAppCatalog() {
  return APPS.map(app => ({ ...app, available: process.platform === 'win32' || app.kind === 'panel' }));
}

export async function launchWindowsApp(id) {
  const app = APPS.find(item => item.id === id);
  if (!app) return { ok: false, error: 'Unknown app.' };
  if (app.kind === 'panel') return { ok: true, app, panel: 'mrd-admin' };
  if (process.platform !== 'win32') return { ok: false, error: 'Windows app launching is available only on the Windows host.' };

  const script = START_SCRIPTS[id];
  if (!script) return { ok: false, error: `${app.name} does not have a launch command.` };

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { windowsHide: true, timeout: 15000 });
    return { ok: true, app, surface: 'desktop' };
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    return { ok: false, error: detail || `Could not launch ${app.name}.` };
  }
}

export async function restartGuacamole(root) {
  const dockerEnv = path.join(root, 'docker', '.env');
  const composeFile = path.join(root, 'docker', 'compose.guacamole.yml');
  try {
    await execFileAsync('docker', [
      'compose', '--env-file', dockerEnv, '-f', composeFile, 'restart', 'guacamole', 'guacd'
    ], { windowsHide: true, timeout: 45000 });
    return { ok: true, action: 'restart-guacamole' };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message || '').trim() || 'Could not restart Guacamole.' };
  }
}

export async function restartDockerDesktop() {
  if (process.platform !== 'win32') return { ok: false, error: 'Docker Desktop restart is Windows-only.' };
  const script = String.raw`
Get-Process 'Docker Desktop','com.docker.backend' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path $exe)) { throw 'Docker Desktop executable was not found.' }
Start-Process $exe
`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 15000
    });
    return { ok: true, action: 'restart-docker' };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message || '').trim() || 'Could not restart Docker Desktop.' };
  }
}

export async function restartTailscale() {
  if (process.platform !== 'win32') return { ok: false, error: 'Tailscale restart is Windows-only.' };
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', "Restart-Service -Name Tailscale -Force -ErrorAction Stop"
    ], { windowsHide: true, timeout: 15000 });
    return { ok: true, action: 'restart-tailscale' };
  } catch (error) {
    return {
      ok: false,
      error: String(error.stderr || error.message || '').trim() || 'Could not restart Tailscale. This action may require an elevated MRD host.'
    };
  }
}
