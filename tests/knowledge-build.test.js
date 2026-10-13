const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const generator = require('../scripts/knowledge');

test('build rejects malformed external catalogue data before publishing typed runtime modules', () => {
  const file = path.resolve(__dirname, '../scripts/typescript-build.js');
  const localRequire = createRequire(file);
  let corrupt = (items) => { items[0].gradeMappings[0].grade = '一年级'; };
  const module = { exports: {} };
  const injectedRequire = (name) => name === './knowledge' ? {
    ...generator, knowledge: () => { const items = generator.knowledge(); corrupt(items); return items; }
  } : localRequire(name);
  injectedRequire.resolve = localRequire.resolve;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: injectedRequire, module, __dirname: path.dirname(file), process, console
  });
  assert.throws(() => module.exports.artifacts(), /Invalid knowledge data: .*grade/);
  corrupt = (items) => { items[1].id = items[0].id; };
  assert.throws(() => module.exports.artifacts(), /id must be unique/);
});
