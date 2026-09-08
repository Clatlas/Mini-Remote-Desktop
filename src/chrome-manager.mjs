import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GOOGLE = 'https://www.google.com/';
const MODES = new Set(['normal', 'incognito']);
const MRD_DISPLAY_WIDTH = Number(process.env.MRD_SECRET_WIDTH || 880);
const MRD_DISPLAY_HEIGHT = Number(process.env.MRD_SECRET_HEIGHT || 1912);

export class ChromeManager {
  constructor(root) {
    this.root = root;
    this.runtimeDir = path.join(root, '.runtime');
    this.stateFile = path.join(this.runtimeDir, 'chrome-window.json');
    this.chromePath = null;
    this.profileDirectory = null;
    this.managed = null;
    this.stateLoaded = false;
    this.lastError = null;
    this.targetDisplay = null;
  }

  get status() {
    return {
      chromeAvailable: Boolean(this.chromePath),
      chromePath: this.chromePath,
      profileDirectory: this.profileDirectory,
      profileSource: 'existing-chrome-profile',
      managed: Boolean(this.managed?.hwnd),
      hwnd: this.managed?.hwnd || null,
      mode: this.managed?.mode || null,
      launchedAt: this.managed?.launchedAt || null,
      targetDisplay: this.targetDisplay,
      singleton: true,
      silentLaunch: true,
      virtualDisplayRequired: true,
      lastError: this.lastError
    };
  }

  async refreshStatus() {
    this.lastError = null;
    if (process.platform !== 'win32') {
      this.chromePath = null;
      this.profileDirectory = null;
      this.targetDisplay = null;
      return this.status;
    }

    this.chromePath = findChrome();
    this.profileDirectory ||= await findProfileDirectory();
    await this.loadState();

    if (this.managed?.hwnd && !(await isChromeWindow(this.managed.hwnd))) {
      this.managed = null;
      await this.saveState();
    }

    if (!this.chromePath) {
      this.lastError = 'Google Chrome was not found. Checked MRD_CHROME_EXE/MRD_CHROME, Program Files, Program Files (x86), and the current user LocalAppData.';
    }
    return this.status;
  }

  async open({ mode = 'incognito', display = null, url = GOOGLE } = {}) {
    mode = String(mode || 'incognito').toLowerCase();
    if (!MODES.has(mode)) return { ok: false, error: 'Chrome mode must be normal or incognito.' };

    await this.refreshStatus();
    if (!this.chromePath) return { ok: false, error: this.lastError || 'Google Chrome is not installed.' };

    const target = await resolveMrdVirtualDisplay(display);
    this.targetDisplay = target;
    if (!target) {
      this.lastError = `MRD Chrome requires the ${MRD_DISPLAY_WIDTH}x${MRD_DISPLAY_HEIGHT} virtual display. No physical-monitor fallback is allowed.`;
      return { ok: false, error: this.lastError };
    }

    if (this.managed?.hwnd) {
      if (this.managed.mode === mode) {
        const focused = await placeAndShow(this.managed.hwnd, target);
        if (focused) {
          return { ok: true, action: 'focused', mode, targetDisplay: target, status: this.status };
        }
        try { await closeWindow(this.managed.hwnd); } catch {}
        this.lastError = 'MRD could not confine the managed Chrome window to the MRD virtual display.';
        this.managed = null;
        await this.saveState();
        return { ok: false, error: this.lastError };
      }
      await this.close();
    }

    const before = new Set(await listChromeWindows());
    const args = [
      '--new-window',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      `--window-position=${target.x + 8},${target.y + 8}`,
      `--window-size=${Math.max(640, target.width - 16)},${Math.max(480, target.height - 16)}`
    ];

    if (this.profileDirectory) args.push(`--profile-directory=${this.profileDirectory}`);
    if (mode === 'incognito') args.push('--incognito');
    args.push(normalizeUrl(url));

    try {
      const child = spawn(this.chromePath, args, {
        cwd: this.root,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (error) {
      this.lastError = error.message;
      return { ok: false, error: `Could not launch Google Chrome: ${error.message}` };
    }

    const hwnd = await waitForNewChromeWindow(before, 7000);
    if (!hwnd) {
      this.lastError = 'Chrome launched, but MRD could not identify the new Chrome window.';
      return { ok: false, error: this.lastError };
    }

    this.managed = {
      hwnd: String(hwnd),
      mode,
      launchedAt: Date.now()
    };
    await this.saveState();

    const shown = await placeAndShow(hwnd, target);
    if (!shown) {
      try { await closeWindow(hwnd); } catch {}
      this.managed = null;
      await this.saveState();
      this.lastError = 'Chrome opened, but MRD could not verify its window inside the MRD virtual display. It was closed instead of being left on a physical monitor.';
      return { ok: false, error: this.lastError };
    }

    return {
      ok: true,
      action: 'launched',
      mode,
      targetDisplay: target,
      status: this.status
    };
  }

  async focus({ display = null } = {}) {
    await this.refreshStatus();
    if (!this.managed?.hwnd) return { ok: false, error: 'MRD does not currently own a Chrome window.' };
    const target = await resolveMrdVirtualDisplay(display);
    this.targetDisplay = target;
    if (!target) return { ok: false, error: `MRD Chrome requires the ${MRD_DISPLAY_WIDTH}x${MRD_DISPLAY_HEIGHT} virtual display.` };
    const ok = await placeAndShow(this.managed.hwnd, target);
    if (!ok) return { ok: false, error: 'The managed Chrome window could not be verified on the MRD virtual display.' };
    return { ok: true, action: 'focused', mode: this.managed.mode, targetDisplay: target, status: this.status };
  }

  async close() {
    await this.refreshStatus();
    const hwnd = this.managed?.hwnd;
    if (!hwnd) return { ok: true, action: 'already-closed', status: this.status };

    try { await closeWindow(hwnd); } catch {}

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (!(await isChromeWindow(hwnd))) break;
      await delay(120);
    }

    this.managed = null;
    await this.saveState();
    return { ok: true, action: 'closed', status: this.status };
  }

  async loadState() {
    if (this.stateLoaded) return;
    this.stateLoaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (value?.hwnd && MODES.has(value?.mode)) {
        this.managed = {
          hwnd: String(value.hwnd),
          mode: value.mode,
          launchedAt: Number(value.launchedAt) || null
        };
      }
    } catch {}
  }

  async saveState() {
    await fs.mkdir(this.runtimeDir, { recursive: true });
    if (!this.managed) {
      try { await fs.rm(this.stateFile, { force: true }); } catch {}
      return;
    }
    await fs.writeFile(this.stateFile, JSON.stringify(this.managed, null, 2), 'utf8');
  }
}

function findChrome() {
  const legacyOverride = process.env.MRD_CHROME;
  const override = process.env.MRD_CHROME_EXE || legacyOverride;
  if (override && fssync.existsSync(override)) return override;

  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : null);

  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);

  return candidates.find(candidate => fssync.existsSync(candidate)) || null;
}

async function findProfileDirectory() {
  const override = String(process.env.MRD_CHROME_PROFILE || '').trim();
  if (override) return override;

  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : null);
  if (!localAppData) return 'Default';

  const localState = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State');
  try {
    const value = JSON.parse(await fs.readFile(localState, 'utf8'));
    const lastUsed = String(value?.profile?.last_used || '').trim();
    if (lastUsed) return lastUsed;
  } catch {}
  return 'Default';
}

function normalizeUrl(value) {
  const text = String(value || GOOGLE).trim();
  if (!text) return GOOGLE;
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {}
  return GOOGLE;
}

function normalizeDisplay(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 320 || height < 240) return null;
  return {
    x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height),
    deviceName: value?.deviceName ? String(value.deviceName) : null
  };
}

async function resolveMrdVirtualDisplay(preferred = null) {
  const preferredTarget = normalizeDisplay(preferred);
  if (preferredTarget && preferredTarget.width === MRD_DISPLAY_WIDTH && preferredTarget.height === MRD_DISPLAY_HEIGHT) {
    return preferredTarget;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const detected = await findMrdVirtualDisplay();
    if (detected) return detected;
    if (attempt < 3) await delay(200);
  }
  return null;
}

async function findMrdVirtualDisplay() {
  if (process.platform !== 'win32') return null;
  const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::AllScreens |
  Where-Object { $_.Bounds.Width -eq ${MRD_DISPLAY_WIDTH} -and $_.Bounds.Height -eq ${MRD_DISPLAY_HEIGHT} -and -not $_.Primary } |
  Select-Object -First 1
if ($screen) {
  [pscustomobject]@{
    x = $screen.Bounds.X
    y = $screen.Bounds.Y
    width = $screen.Bounds.Width
    height = $screen.Bounds.Height
    deviceName = $screen.DeviceName
  } | ConvertTo-Json -Compress
}
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 });
    const text = String(stdout || '').trim();
    if (!text) return null;
    const value = JSON.parse(text);
    return normalizeDisplay(value);
  } catch {
    return null;
  }
}

async function waitForNewChromeWindow(before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handles = await listChromeWindows();
    const created = handles.find(hwnd => !before.has(hwnd));
    if (created) return created;
    await delay(120);
  }
  return null;
}

async function listChromeWindows() {
  if (process.platform !== 'win32') return [];
  try {
    const stdout = await runWindowScript('[MrdChromeWindow]::ListChrome() | ConvertTo-Json -Compress');
    const text = stdout.trim();
    if (!text) return [];
    let value = JSON.parse(text);
    if (!Array.isArray(value)) value = value == null ? [] : [value];
    return value.map(item => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

async function isChromeWindow(hwnd) {
  if (process.platform !== 'win32' || !/^\d+$/.test(String(hwnd || ''))) return false;
  try {
    const stdout = await runWindowScript(`[MrdChromeWindow]::IsChrome([IntPtr]${String(hwnd)})`);
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

async function placeAndShow(hwnd, display) {
  if (process.platform !== 'win32' || !/^\d+$/.test(String(hwnd || ''))) return false;
  const target = normalizeDisplay(display);
  if (!target) return false;
  try {
    const command = `[MrdChromeWindow]::PlaceAndShow([IntPtr]${String(hwnd)},${target.x},${target.y},${target.width},${target.height})`;
    const stdout = await runWindowScript(command);
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

async function closeWindow(hwnd) {
  if (process.platform !== 'win32' || !/^\d+$/.test(String(hwnd || ''))) return false;
  const stdout = await runWindowScript(`[MrdChromeWindow]::Close([IntPtr]${String(hwnd)})`);
  return stdout.trim().toLowerCase() === 'true';
}

async function runWindowScript(command) {
  const script = `${WINDOW_HELPER}\n${command}`;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { windowsHide: true, timeout: 12000, maxBuffer: 512 * 1024 });
  return String(stdout || '');
}

const WINDOW_HELPER = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class MrdChromeWindow {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    private const int SW_RESTORE = 9;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint WM_CLOSE = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private static bool BelongsToChrome(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == 0) return false;
        try {
            Process process = Process.GetProcessById((int)pid);
            return String.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static bool CenterInsideTarget(IntPtr hWnd, int x, int y, int width, int height) {
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) return false;
        long centerX = ((long)rect.Left + rect.Right) / 2;
        long centerY = ((long)rect.Top + rect.Bottom) / 2;
        return centerX >= x && centerX < (long)x + width
            && centerY >= y && centerY < (long)y + height;
    }

    public static long[] ListChrome() {
        List<long> handles = new List<long>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd) && BelongsToChrome(hWnd)) handles.Add(hWnd.ToInt64());
            return true;
        }, IntPtr.Zero);
        return handles.ToArray();
    }

    public static bool IsChrome(IntPtr hWnd) {
        return BelongsToChrome(hWnd);
    }

    public static bool PlaceAndShow(IntPtr hWnd, int x, int y, int width, int height) {
        if (!BelongsToChrome(hWnd)) return false;

        int inset = 8;
        int left = x + inset;
        int top = y + inset;
        int w = Math.Max(320, width - inset * 2);
        int h = Math.Max(240, height - inset * 2);
        bool moved = false;

        for (int attempt = 0; attempt < 12; attempt++) {
            ShowWindow(hWnd, SW_RESTORE);
            if (IsIconic(hWnd)) {
                Thread.Sleep(80);
                ShowWindow(hWnd, SW_RESTORE);
            }

            moved = SetWindowPos(hWnd, IntPtr.Zero, left, top, w, h, SWP_NOZORDER) || moved;
            Thread.Sleep(180);
        }

        bool verified = moved && CenterInsideTarget(hWnd, x, y, width, height);
        if (verified) SetForegroundWindow(hWnd);
        return verified;
    }

    public static bool Close(IntPtr hWnd) {
        if (!BelongsToChrome(hWnd)) return false;
        return PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }
}
'@
`;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
