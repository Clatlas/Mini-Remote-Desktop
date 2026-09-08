import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error(`AUDIT FAIL: ${message}`); process.exitCode = 1; };

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const index = read('public/index.html');
const sw = read('public/sw.js');
const server = read('src/server.mjs');
const appCatalog = read('src/app-catalog.mjs');

const htmlIds = [...index.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
if (duplicates.length) fail(`duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);

const shellAssets = [...index.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1]);
const jsAssets = shellAssets.filter(asset => asset.split('?')[0].endsWith('.js'));
const jsSources = jsAssets.map(asset => ({
  asset,
  source: read(`public/${asset.split('?')[0].replace(/^\//, '')}`)
}));

// MRD modules create several panels/targets dynamically. Build one global ID set
// from the static HTML plus literal IDs declared inside the loaded JS modules,
// then verify every module's $('literal-id') lookup resolves somewhere.
const knownIds = new Set(htmlIds);
for (const { source } of jsSources) {
  for (const match of source.matchAll(/\bid=["']([^"']+)["']/g)) knownIds.add(match[1]);
  for (const match of source.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)) knownIds.add(match[1]);
}
for (const { asset, source } of jsSources) {
  const refs = [...source.matchAll(/\$\(["']([^"']+)["']\)/g)].map(match => match[1]);
  const missing = [...new Set(refs.filter(id => !knownIds.has(id)))];
  if (missing.length) fail(`${asset} references unresolved MRD ids: ${missing.join(', ')}`);
}

for (const asset of shellAssets) {
  if (!sw.includes(`'${asset}'`) && !sw.includes(`"${asset}"`)) fail(`service worker APP_SHELL does not precache exact index asset ${asset}`);
}

for (const asset of shellAssets) {
  const match = asset.match(/[?&]v=([^&]+)/);
  if (match && match[1] !== version) fail(`asset ${asset} is cache-busted as ${match[1]} but package version is ${version}`);
}

if (!sw.includes(`mrd-v${version}`)) fail(`service worker cache name does not include v${version}`);
if (!server.includes(`version: '${version}'`) && !server.includes(`version: "${version}"`)) fail(`server /api/config version is not ${version}`);
if (index.includes('/browser-engine.js') || server.includes('BrowserEngine')) fail('legacy Browser Engine remains wired into MRD');
if (!index.includes('/chrome-window.js') || !server.includes('/api/chrome/open')) fail('managed Chrome window client/server wiring is missing');
if (!/id\s*===\s*['"]update-mrd['"][\s\S]{0,120}launchWindowsApp\(id\)/.test(appCatalog)) {
  fail('AppCatalog does not delegate the allowlisted update-mrd action to launchWindowsApp');
}

for (const asset of shellAssets) {
  const pathname = asset.split('?')[0];
  const local = path.join(root, 'public', pathname.replace(/^\//, ''));
  if (!fs.existsSync(local)) fail(`index references missing asset ${pathname}`);
}

if (fs.existsSync(path.join(root, 'public', 'update-control.js'))) {
  fail('obsolete public/update-control.js still exists; updater ownership must remain in public/app.js');
}

if (!process.exitCode) {
  console.log(`MRD static audit passed for v${version}: ${htmlIds.length} static HTML ids, ${knownIds.size} total known UI ids, ${shellAssets.length} versioned JS/CSS assets.`);
}
