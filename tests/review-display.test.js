const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vocabulary = require('../scripts/english-vocabulary');
const learning = require('../shared/learning');
const resources = require('../shared/resources');
const guides = require('../data/catalogs/english-word-study.json');
const { books } = require('../scripts/lower-primary').data;

test('verified vocabulary occurrences replace only their own hints, with exact semicolon deduplication', () => {
  const item = { id: 'probe', kind: 'word', title: 'probe', detail: 'probe\n已知；共同', source: '测试', collections: ['tables'], aliases: [] };
  const state = new Map();
  vocabulary.collect(item, { text: 'probe', meaning: '过时的原页提示', textbookSenses: [{ partOfSpeech: 'adj.', meaning: '小心；共同' }] }, state);
  vocabulary.collect(item, { text: 'probe', meaning: '共同；已知；小心；小；待核实义项' }, state);
  vocabulary.collect(item, { text: 'probe', meaning: '小；待核实义项', textbookSenses: [] }, state);
  vocabulary.finish([item], state);
  assert.doesNotMatch(item.detail, /过时的原页提示/);
  assert.match(item.detail, /常用义：\n已知；共同/);
  assert.match(item.detail, /教材用法：\nadj\. 小心；共同/);
  assert.equal(item.detail.split('单元学习提示（自编，原页义项待核实）：\n')[1], '小；待核实义项');
  assert.doesNotMatch(item.detail.split('教材用法：')[0], /待核实义项/);
});

test('words with original senses for every mapped unit no longer carry unverified unit labels', () => {
  const unitsById = new Map();
  for (const book of books) for (const unit of book.units) for (const word of unit.words || []) {
    const item = learning.searchCatalog({ bookId: book.id, unitId: unit.id, kind: 'word' }).find(i => i.aliases.includes(word.text));
    assert.ok(item, `${book.id}/${unit.id}/${word.text}`);
    const occurrences = unitsById.get(item.id) || []; occurrences.push(word); unitsById.set(item.id, occurrences);
  }
  let checked = 0;
  for (const [id, occurrences] of unitsById) if (occurrences.every(word => word.textbookSenses?.length)) {
    checked++; assert.doesNotMatch(learning.catalogById.get(id).detail, /单元学习提示（自编，原页义项待核实）/, id);
  }
  assert.ok(checked > 1000);
  const ring = learning.catalogById.get('word-ring');
  assert.match(ring.detail, /戒指/); assert.doesNotMatch(ring.detail, /单元学习提示/);
});

test('all inflection prompts preserve the selected meaning without wrapping its parentheses again', () => {
  let qualifiedMeanings = 0;
  for (const entry of guides.entries.filter(entry => entry.forms.length)) {
    const form = entry.forms.find(form => form.label === '动词过去式') || entry.forms[0];
    const question = learning.catalogById.get(entry.contentId).studyNotes.exercises[0].question;
    assert.ok(question.includes(`${entry.lemma}「${form.sense.meaning}」`), entry.lemma);
    assert.doesNotMatch(question, /（（|））/, entry.lemma);
    if (form.sense.meaning.startsWith('（')) qualifiedMeanings++;
  }
  assert.equal(qualifiedMeanings, 25);
  assert.match(learning.catalogById.get('word-achieve').studyNotes.exercises[0].question, /achieve「（凭长期努力）/);
});

test('progress discloses sample-only grade mappings without requiring a new cloud field or changing statistics', async t => {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/progress/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; delete require.cache[file]; });
  const ledger = { records: {} };
  const poem = learning.catalogById.get('moe-2022-zh-1-6-001');
  learning.recordTasks(ledger, [{ ...learning.taskFrom(poem, 'child', 'task', 'manual'), done: true }], '2026-10-19');
  const result = { ...learning.progress(ledger), cached: false }, before = JSON.stringify(result);
  const instance = { ...definition, active: true, data: { ...structuredClone(definition.data), family: { id: 'family' }, childId: 'child' },
    engine: { getProgress: async () => result }, setData(patch) { Object.assign(this.data, patch); } };
  instance.afterRender(); await instance.loadProgress();
  assert.strictEqual(instance.data.progress, result); assert.equal(JSON.stringify(result), before);
  assert.equal(instance.data.progress.grades[0].total, 151); assert.equal(instance.data.progress.grades[1].total, 120);
  assert.match(instance.data.gradeSourceNotes[1], /29 项仅有第三方样本依据/);
  assert.match(instance.data.gradeSourceNotes[2], /60 项仅有第三方样本依据/);
  assert.equal(instance.data.gradeSourceNotes[9], '');
  const template = fs.readFileSync('miniprogram/pages/progress/index.wxml', 'utf8');
  assert.match(template, /查看已入库内容/); assert.match(template, /gradeSourceNotes\[item.grade\]/);
  assert.doesNotMatch(template, /已核实/);
});

test('textbook sources display the verified rollout policy without upgrading seven historical volumes', () => {
  const policy = resources.curriculum.editionTransition;
  assert.equal(policy.sourceTitle, '沪教委基〔2024〕19号'); assert.equal(policy.sourcePdfPage, 2);
  assert.equal(policy.sourceUrl, 'https://www.shqp.gov.cn/edu/edu/upload/202408/0829_152637_882.pdf');
  assert.match(policy.summary, /2026学年起/); assert.match(policy.boundary, /2027年春季.*待核实/);
  assert.equal(resources.curriculum.slots.filter(slot => slot.editionReview).length, 7);
  assert.match(fs.readFileSync('miniprogram/pages/library/index.wxml', 'utf8'), /resources\.curriculum\.editionTransition\.sourceUrl/);
});
