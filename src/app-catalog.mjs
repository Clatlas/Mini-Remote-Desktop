import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAppCatalog as getBuiltInApps, launchWindowsApp } from './windows-apps.mjs';

const execFileAsync = promisify(execFile);

export class AppCatalog {
  constructor(root) {
    this.root = root;
    this.configFile = path.join(root, '.runtime', 'apps.json');
    this.config = null;
  }

  async getCatalog() {
    const config = await this.load();
    const builtins = getBuiltInApps();
    const all = [...builtins, ...config.custom.map(item => ({ ...item, available: process.platform === 'win32' }))];
    const hidden = new Set(config.hidden);
    const visible = all.filter(item => !hidden.has(item.id));
    const order = new Map(config.order.map((id, index) => [id, index]));
    visible.sort((a, b) => {
      const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
    return visible;
  }

  async discover() {
    if (process.platform !== 'win32') return [];
    const script = String.raw`
Get-StartApps |
  Where-Object { $_.Name -and $_.AppID } |
  Sort-Object Name -Unique |
  Select-Object Name,AppID |
  ConvertTo-Json -Compress
`;
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    let parsed = [];
    try { parsed = JSON.parse(stdout.trim() || '[]'); } catch {}
    if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];

    const current = await this.getCatalog();
    const names = new Set(current.map(item => item.name.toLowerCase()));
    return parsed
      .filter(item => item?.Name && item?.AppID && !names.has(String(item.Name).toLowerCase()))
      .map(item => ({ name: String(item.Name), appId: String(item.AppID) }))
      .slice(0, 500);
  }

  async pin({ appId, name, category = 'Other' } = {}) {
    if (process.platform !== 'win32') return { ok: false, error: 'Installed app discovery is Windows-only.' };
    const candidates = await this.discoverRaw();
    const match = candidates.find(item => item.appId === String(appId || '') && item.name === String(name || ''));
    if (!match) return { ok: false, error: 'That app was not found in the current Windows Start Apps list.' };

    const config = await this.load();
    const id = `startapp-${crypto.createHash('sha256').update(match.appId).digest('hex').slice(0, 12)}`;
    if (!config.custom.some(item => item.id === id)) {
      config.custom.push({
        id,
        name: match.name,
        category: cleanCategory(category),
        icon: '□',
        description: 'Pinned Windows app',
        kind: 'start-app',
        appId: match.appId
      });
    }
    config.hidden = config.hidden.filter(item => item !== id);
    if (!config.order.includes(id)) config.order.push(id);
    await this.save(config);
    return { ok: true, app: config.custom.find(item => item.id === id), apps: await this.getCatalog() };
  }

  async remove(id) {
    const config = await this.load();
    const builtins = new Set(getBuiltInApps().map(item => item.id));
    const customIndex = config.custom.findIndex(item => item.id === id);
    if (customIndex >= 0) config.custom.splice(customIndex, 1);
    else if (builtins.has(id) && !config.hidden.includes(id)) config.hidden.push(id);
    else return { ok: false, error: 'App is not pinned.' };
    config.order = config.order.filter(item => item !== id);
    await this.save(config);
    return { ok: true, apps: await this.getCatalog() };
  }

  async restoreDefaults() {
    const builtins = getBuiltInApps().map(item => item.id);
    const config = await this.load();
    config.hidden = [];
    config.order = [...builtins, ...config.custom.map(item => item.id)];
    await this.save(config);
    return { ok: true, apps: await this.getCatalog() };
  }

  async reorder(ids) {
    const catalog = await this.getCatalog();
    const visibleIds = new Set(catalog.map(item => item.id));
    const requested = Array.isArray(ids) ? ids.map(String) : [];
    if (requested.length !== visibleIds.size || requested.some(id => !visibleIds.has(id)) || new Set(requested).size !== requested.length) {
      return { ok: false, error: 'Order must include each currently pinned app exactly once.' };
    }
    const config = await this.load();
    config.order = requested;
    await this.save(config);
    return { ok: true, apps: await this.getCatalog() };
  }

  async launch(id) {
    // Update MRD is an allowlisted maintenance action rather than a visible app
    // catalog entry. Keep it routed through the hardened Windows launcher.
    if (id === 'update-mrd') return launchWindowsApp(id);

    const builtin = getBuiltInApps().find(item => item.id === id);
    if (builtin) return launchWindowsApp(id);

    const config = await this.load();
    const app = config.custom.find(item => item.id === id);
    if (!app) return { ok: false, error: 'Unknown app.' };
    if (process.platform !== 'win32') return { ok: false, error: 'Windows app launching is available only on the Windows host.' };
    if (!app.appId) return { ok: false, error: 'Pinned app is missing its Windows AppID.' };

    const escaped = app.appId.replace(/'/g, "''");
    const script = `Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\${escaped}'`;
    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
      ], { windowsHide: true, timeout: 15000 });
      return { ok: true, app: publicApp(app), surface: 'desktop' };
    } catch (error) {
      return { ok: false, error: String(error.stderr || error.stdout || error.message || '').trim() || `Could not launch ${app.name}.` };
    }
  }

  async discoverRaw() {
    if (process.platform !== 'win32') return [];
    const script = String.raw`
Get-StartApps |
  Where-Object { $_.Name -and $_.AppID } |
  Sort-Object Name -Unique |
  Select-Object Name,AppID |
  ConvertTo-Json -Compress
`;
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    let parsed = [];
    try { parsed = JSON.parse(stdout.trim() || '[]'); } catch {}
    if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];
    return parsed.filter(item => item?.Name && item?.AppID).map(item => ({ name: String(item.Name), appId: String(item.AppID) }));
  }

  async load() {
    if (this.config) return this.config;
    const builtins = getBuiltInApps().map(item => item.id);
    let value = null;
    try { value = JSON.parse(await fs.readFile(this.configFile, 'utf8')); } catch {}
    this.config = normalize(value, builtins);
    return this.config;
  }

  async save(value) {
    this.config = normalize(value, getBuiltInApps().map(item => item.id));
    await fs.mkdir(path.dirname(this.configFile), { recursive: true });
    await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
  }
}

function normalize(value, builtins) {
  const custom = Array.isArray(value?.custom)
    ? value.custom.filter(item => item?.id && item?.name && item?.appId).map(item => ({
        id: String(item.id), name: String(item.name), category: cleanCategory(item.category), icon: String(item.icon || '□'),
        description: String(item.description || 'Pinned Windows app'), kind: 'start-app', appId: String(item.appId)
      }))
    : [];
  const known = new Set([...builtins, ...custom.map(item => item.id)]);
  const order = Array.isArray(value?.order) ? value.order.map(String).filter(id => known.has(id)) : [];
  for (const id of known) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(value?.hidden) ? [...new Set(value.hidden.map(String).filter(id => known.has(id)))] : [];
  return { order, hidden, custom };
}

function cleanCategory(value) {
  const text = String(value || 'Other').trim().slice(0, 40);
  return text || 'Other';
}

function publicApp(app) {
  const { appId, ...rest } = app;
  return rest;
}
