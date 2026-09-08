import { spawn } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const port = 18787;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['src/server.mjs'], {
  env: {
    ...process.env,
    PC_REMOTE_HOST: '127.0.0.1',
    PC_REMOTE_PORT: String(port),
    PC_REMOTE_NAME: 'MRD CI Host',
    PC_REMOTE_DEMO_STATE: 'onlineLocked',
    ALLOW_POWER_CONTROLS: 'false'
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let output = '';
child.stdout.on('data', d => { output += d.toString(); });
child.stderr.on('data', d => { output += d.toString(); });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path, options = {}) {
  const response = await fetch(base + path, { cache: 'no-store', ...options });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 500)}`);
  return body;
}

async function waitForHost() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/api/status', { cache: 'no-store' });
      if (response.ok) return;
    } catch {}
    await delay(350);
  }
  throw new Error(`MRD host did not become ready.\n${output}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForHost();

  const config = await getJson('/api/config');
  assert(config.version === pkg.version, `Expected config version ${pkg.version}, got ${config.version}`);
  assert(config.desktop?.enabled === true, 'Desktop must be enabled');
  assert(Array.isArray(config.audio?.destinations) && config.audio.destinations.includes('mobile'), 'Audio destinations missing mobile');

  const status = await getJson('/api/status');
  assert(status.state === 'onlineLocked', `Demo status expected onlineLocked, got ${status.state}`);
  assert(status.name === 'MRD CI Host', `Unexpected PC name ${status.name}`);
  assert(Number.isFinite(status.metrics?.cpuPercent), 'CPU metric missing');
  assert(Number.isFinite(status.metrics?.memoryPercent), 'RAM metric missing');

  const apps = await getJson('/api/apps');
  const ids = new Set((apps.apps || []).map(app => app.id));
  for (const required of ['chrome','explorer','terminal','task-manager','settings','github-desktop','steam','photos','aura','services','mrd-admin']) {
    assert(ids.has(required), `Default app missing: ${required}`);
  }

  const session = await getJson('/api/session');
  assert(session.notSecretSupported === true, 'Not Secret transport should be supported');

  const prepared = await getJson('/api/session/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privacyMode: 'not-secret' })
  });
  assert(prepared.transport === 'rdp', `Expected rdp transport, got ${prepared.transport}`);
  assert(typeof prepared.desktopPath === 'string' && prepared.desktopPath.startsWith('/guacamole/'), 'RDP desktop path missing');

  const home = await fetch(base + '/', { cache: 'no-store' });
  const html = await home.text();
  assert(home.ok && html.includes('Mini Remote Desktop'), 'PWA index did not serve');
  assert(html.includes(`/browser-engine.js?v=${pkg.version}`), 'Browser Engine client version mismatch');

  console.log(`MRD server smoke test passed for v${pkg.version}.`);
} finally {
  try { child.kill('SIGTERM'); } catch {}
  await delay(500);
  if (child.exitCode == null) {
    try { child.kill(); } catch {}
  }
}
