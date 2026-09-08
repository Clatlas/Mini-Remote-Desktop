import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';

let installed = false;
let logPath = null;

export function installRuntimeLogging(root) {
  if (installed) return logPath;
  installed = true;
  const runtimeDir = path.join(root, '.runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  logPath = path.join(runtimeDir, 'mrd.log');

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${args.map(format).join(' ')}\n`;
      try { fs.appendFile(logPath, line, () => {}); } catch {}
    };
  }
  trimLog(logPath).catch(() => {});
  return logPath;
}

export async function readRuntimeLog(root, maxLines = 200) {
  const file = path.join(root, '.runtime', 'mrd.log');
  try {
    const text = await fsp.readFile(file, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(1000, maxLines))).join('\n');
  } catch {
    return 'MRD runtime log is empty.';
  }
}

async function trimLog(file) {
  try {
    const stat = await fsp.stat(file);
    if (stat.size < 2 * 1024 * 1024) return;
    const text = await fsp.readFile(file, 'utf8');
    const lines = text.split(/\r?\n/).slice(-2000).join('\n');
    await fsp.writeFile(file, `${lines}\n`);
  } catch {}
}

function format(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  return util.inspect(value, { depth: 4, breakLength: 160 });
}
