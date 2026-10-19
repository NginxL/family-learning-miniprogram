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
  corrupt = (items) => { delete items.find(item => item.learningArea).manualOnly; };
  assert.throws(() => module.exports.artifacts(), /manualOnly must protect existing templates/);
  corrupt = (items) => { items.find(item => item.recitationRequirements).recitationRequirements[0].sourceUrl = 'https://example.com/unverified'; };
  assert.throws(() => module.exports.artifacts(), /recitationRequirements source/);
  corrupt = (items) => { items.find(item => item.id === 'sh54-night-reading').recitationRequirements
    .find(entry => entry.bookId === 'chinese-3a-sample').sourceUrl = 'https://basic.smartedu.cn/tchMaterial/detail?contentId=unreviewed'; };
  assert.throws(() => module.exports.artifacts(), /recitationRequirements source/);
  corrupt = (items) => { items.find(item => item.id === 'sh54-night-reading').recitationRequirements
    .find(entry => entry.bookId === 'chinese-3a-sample').sourcePdfPage++; };
  assert.throws(() => module.exports.artifacts(), /recitationRequirements source/);
  corrupt = (items) => { items.find(item => item.studyNotes).studyNotes.exercises[0].answer = ''; };
  assert.throws(() => module.exports.artifacts(), /studyNotes.exercises.answer/);
  corrupt = (items) => { items.find(item => item.studyNotes).studyNotes.sources[0].url = 'javascript:alert(1)'; };
  assert.throws(() => module.exports.artifacts(), /studyNotes.sources.url/);
});
