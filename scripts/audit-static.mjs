import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error(`AUDIT FAIL: ${message}`); process.exitCode = 1; };

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const index = read('public/index.html');
const appJs = read('public/app.js');
const sw = read('public/sw.js');
const server = read('src/server.mjs');

const htmlIds = [...index.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
if (duplicates.length) fail(`duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);

const idSet = new Set(htmlIds);
const appRefs = [...appJs.matchAll(/\$\(["']([^"']+)["']\)/g)].map(match => match[1]);
const missingRefs = [...new Set(appRefs.filter(id => !idSet.has(id)))];
if (missingRefs.length) fail(`public/app.js references missing index.html ids: ${missingRefs.join(', ')}`);

const shellAssets = [...index.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1]);
for (const asset of shellAssets) {
  if (!sw.includes(`'${asset}'`) && !sw.includes(`\"${asset}\"`)) fail(`service worker APP_SHELL does not precache exact index asset ${asset}`);
}

for (const asset of shellAssets) {
  const match = asset.match(/[?&]v=([^&]+)/);
  if (match && match[1] !== version) fail(`asset ${asset} is cache-busted as ${match[1]} but package version is ${version}`);
}

if (!sw.includes(`mrd-v${version}`)) fail(`service worker cache name does not include v${version}`);
if (!server.includes(`version: '${version}'`) && !server.includes(`version: \"${version}\"`)) fail(`server /api/config version is not ${version}`);

for (const asset of shellAssets) {
  const pathname = asset.split('?')[0];
  const local = path.join(root, 'public', pathname.replace(/^\//, ''));
  if (!fs.existsSync(local)) fail(`index references missing asset ${pathname}`);
}

if (!process.exitCode) console.log(`MRD static audit passed for v${version}: ${htmlIds.length} HTML ids, ${shellAssets.length} versioned JS/CSS assets.`);
