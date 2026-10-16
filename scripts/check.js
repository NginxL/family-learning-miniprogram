'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'tmp', 'artifacts', 'output', '.playwright-cli', '.build'].includes(entry.name)) return [];
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
let checked = 0;
for (const file of walk(root)) {
  if (file.endsWith('.js')) { execFileSync(process.execPath, ['--check', file]); checked += 1; }
  if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); checked += 1; }
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json')));
for (const page of app.pages) for (const extension of ['.js', '.wxml']) assert.ok(fs.existsSync(path.join(root, 'miniprogram', page + extension)), `${page}${extension} missing`);
const rules = JSON.parse(fs.readFileSync(path.join(root, 'cloud/database.rules.json')));
for (const name of require('../cloudfunctions/familyApi/store').COLLECTIONS) assert.deepEqual(rules[name], { read: false, write: false });
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'cloud/storage.rules.json'))), { read: false, write: false });
for (const [name, expected] of require('./typescript-build').artifacts()) {
  assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), expected, `Run npm run build: stale ${name}`);
}
for (const name of ['knowledge-data', 'resources']) assert.ok(!fs.existsSync(path.join(root, `miniprogram/lib/learning/${name}.json`)), 'Native loader requires JavaScript data modules');
const content = require('../shared/catalog');
assert.equal(new Set(content.map((item) => item.id)).size, content.length, 'Duplicate learning content ID');
assert.ok(content.every((item) => item.title && item.detail && item.source && item.minutes > 0));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalogs/chinese-moe-2022-index.json')));
assert.equal(catalog.entries.length, 135);
assert.equal(new Set(catalog.entries.map((entry) => entry.id)).size, 135);
const bytes = walk(path.join(root, 'miniprogram')).reduce((sum, file) => sum + fs.statSync(file).size, 0);
assert.ok(bytes < 2 * 1024 * 1024, 'Main package exceeds 2 MiB');
console.log(`Checked ${checked} JS/JSON files, page entries, database rules and 135 catalog entries. Mini program: ${Math.ceil(bytes / 1024)} KiB.`);
