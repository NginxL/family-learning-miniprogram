const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/catalogs/shanghai-54-grade6.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('sixth grade is Shanghai junior school, with two seven-unit Chinese books and independent poetry appendices', () => {
  assert.deepEqual(data.books.map(b => b.semester), ['上册', '下册', '上册', '下册']);
  for (const b of data.books) {
    assert.equal(b.grade, 6); assert.equal(b.schoolSystem, '5-4');
    assert.equal(b.sourceKind, 'official_textbook'); assert.equal(b.schoolAdoption, 'pending');
    assert.match(b.sourceUrl, /^https:\/\/basic.smartedu.cn\/tchMaterial\/detail\?/);
    assert.equal(b.inventory.fullCoverage, false);
    assert.match(b.sourceEvidence.transcriptionSha256, /^[a-f0-9]{64}$/);
    const slot = resources.curriculum.slots.find(s => s.contentBookId === b.id);
    assert.equal(slot.stage, 'junior'); assert.equal(slot.contentStatus, 'partial');
    assert.equal(learning.searchCatalog({ bookId: b.id, grade: 5 }).length, 0);
  }
  const [a, b] = data.books;
  assert.deepEqual(a.units.map(u => u.sourcePrintPage), [1, 21, 45, 67, 89, 103, 115, 134]);
  assert.deepEqual(b.units.map(u => u.sourcePrintPage), [1, 19, 35, 51, 75, 93, 107, 133]);
  for (const book of [a, b]) {
    assert.equal(book.units.length, 8);
    assert.equal(book.units[7].displayLabel, '附录 · 课外古诗词诵读');
    assert.ok(book.units.every(u => u.sourcePdfPage === u.sourcePrintPage + 7));
    assert.ok(!learning.searchCatalog({ bookId: book.id }).some(i => i.studyArea === 'literacy'), 'no invented primary-style character tables');
  }
  assert.equal(data.books[2].units[0].id, 'u0');
  assert.equal(data.books[2].units[0].displayLabel, '预备篇 · Starter');
});

test('all 533 English unit entries have exact original-page locations, including repeated words and easily misheard spellings', () => {
  const [, , a, b] = data.books;
  for (const [book, expected, pages, offset] of [[a, [38, 47, 52, 58, 38, 44], [134,135,136,137,138,139], 9], [b, [47,33,48,44,38,46], [119,120,121,122,123], 7]]) {
    assert.deepEqual(book.units.filter(u => u.number > 0).map(u => u.words.length), expected);
    assert.equal(book.inventory.vocabularyCount, expected.reduce((a, b) => a + b, 0));
    assert.equal(book.inventory.vocabularyListComplete, true);
    assert.deepEqual(book.sourceEvidence.vocabularyPrintPages, pages);
    for (const u of book.units) for (const w of u.words) {
      assert.ok(pages.includes(w.vocabularyPrintPage)); assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + offset);
      const item = learning.searchCatalog({ bookId: book.id, unitId: u.id }).find(i => i.kind === 'word' && (i.aliases || []).includes(w.text));
      assert.ok(item, `${book.id}/${u.id}/${w.text}`);
      assert.ok(item.gradeMappings.some(m => m.bookId === book.id && m.unitId === u.id && m.sourcePrintPage === w.vocabularyPrintPage));
    }
  }
  assert.equal(a.inventory.vocabularyCount + b.inventory.vocabularyCount, 533);
  const animal = a.units.find(u => u.number === 5).words;
  assert.ok(animal.some(w => w.text === 'herd')); assert.ok(animal.some(w => w.text === 'prefer'));
  assert.ok(!animal.some(w => w.text === 'heard' || w.text === 'pet'));
  assert.ok(a.units.find(u => u.number === 6).words.some(w => w.text === 'shall'));
  assert.ok(b.units[0].words.some(w => w.text === 'noticeboard'));
  assert.ok(b.units[2].words.some(w => w.text === 'nut'));
  const tie = learning.catalogById.get('word-tie');
  assert.ok(tie.gradeMappings.some(m => m.bookId === a.id && m.unitId === 'u2'));
  assert.ok(tie.gradeMappings.some(m => m.bookId === a.id && m.unitId === 'u4'));
  assert.match(tie.detail, /纽带/); assert.match(tie.detail, /平手/);
});

test('26 sixth-grade poem locations replace partial outlines while preserving canonical IDs and textual distinctions', () => {
  const maps = data.books.slice(0, 2).flatMap(book => book.units.flatMap(u => u.poems.map(p => ({ book, u, p }))));
  assert.equal(maps.length, 26); assert.equal(data.poems.length, 5);
  for (const { book, u, p } of maps) {
    const item = learning.catalogById.get(p.contentId);
    assert.equal(item.author, p.identityEvidence.author); assert.ok(item.detail.includes(p.identityEvidence.firstLine));
    const actual = item.gradeMappings.filter(m => m.bookId === book.id);
    assert.equal(actual.length, 1); assert.equal(actual[0].unitId, u.id);
    assert.equal(actual[0].sourcePrintPage, p.sourcePrintPage); assert.equal(actual[0].sourcePdfPage, p.sourcePrintPage + 7);
  }
  assert.match(learning.catalogById.get('sh54-two-children').detail, /见两小儿辩斗/);
  assert.equal(learning.catalogById.get('sh54-two-children').author, '《列子》');
  assert.match(learning.catalogById.get('sh54-two-children').dynastyNote, /可能为晋人/);
  assert.match(learning.catalogById.get('sh54-archery').detail, /为国与身亦皆如之/);
  assert.match(learning.catalogById.get('sh54-reading-two').detail, /蒙冲巨舰/);
  assert.equal(learning.catalogById.get('sh54-chess').author, '《孟子》');
  assert.match(learning.catalogById.get('sh54-cicada').detail, /垂緌饮清露/);
  assert.equal(learning.catalogById.get('sh54-caochong').dynasty, '西晋');
  assert.equal(learning.catalogById.get('sh54-tiaotiao-qianniuxing').dynasty, '东汉');
  assert.match(learning.catalogById.get('sh54-shengchazi').gradeMappings[0].evidence, /课后延伸/);
  assert.ok(learning.catalogById.get('moe-2022-zh-1-6-028').gradeMappings.some(m => m.grade === 4));
  assert.ok(learning.catalogById.get('moe-2022-zh-1-6-028').gradeMappings.some(m => m.grade === 6));
});

test('29 new groups contain original readable tasks, questions, answers and English grammar practice', () => {
  assert.equal(data.books.reduce((n, b) => n + b.units.length, 0), 29);
  for (const book of data.books) for (const u of book.units) {
    const items = learning.searchCatalog({ bookId: book.id, unitId: u.id });
    const reading = items.find(i => i.kind === (book.subject === 'chinese' ? 'reading' : 'english-reading'));
    assert.ok(reading, `${book.id}/${u.id}`);
    for (const text of [u.practice.body, u.practice.question, u.practice.answer]) assert.ok(reading.detail.includes(text));
    assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
    if (book.subject === 'chinese') { assert.ok(u.practice.body.length >= 140); assert.ok(pinyinFor(reading)); }
    else {
      assert.equal(u.practice.translation.length, 6); assert.equal(items.filter(i => i.kind === 'sentence').length, 6);
      assert.ok(reading.detail.includes(u.practice.grammar)); assert.match(reading.detail, /1\..*\n2\..*\n3\./);
    }
  }
  const p = learning.progress({ records: {} }).grades[5];
  assert.equal(p.stage, '初中'); assert.equal(p.total, 557); assert.equal(p.practice.total, 107); assert.equal(p.fullGradeComplete, false);
});

test('old poem/word records survive corrected sources and prevent the same work becoming new in a later grade', () => {
  const source = learning.catalogById.get('sh54-reading-two');
  const old = { ...learning.taskFrom(source, 'child', 'old-task', 'new'), detail: source.detail.replace('蒙冲', '艨艟'), done: true };
  const ledger = { records: {} }; learning.recordTasks(ledger, [old], '2026-10-12');
  assert.equal(learning.history(ledger, {}).items[0].id, source.id);
  assert.equal(learning.progress(ledger).grades[5].learned, 1);
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(r => r.kind === 'poetry' ? { ...r, quantity: 10, scope: 'all' } : r) } };
  const planned = learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: ledger });
  assert.ok(!planned.tasks.some(t => t.contentId === source.id));
  const oldWords = ['word-apple', 'word-tie', 'word-programme', 'word-recognise', 'word-t-shirt'];
  for (const id of oldWords) assert.ok(learning.catalogById.has(id));
  assert.equal(learning.catalogById.has('sh54-word-recognise'), false);
});

test('sixth-grade work completes and syncs between parents while library learned filters and school grade remain compatible', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'updateChild', { ...base, name: family.children[0].name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-6b-u8-reading', 'sh54-en-6a-u0-reading', 'sh54-en-6b-u3-reading', 'word-tie', 'sh54-reading-two'];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[5].learned, 2); assert.equal(progress.grades[5].practice.learned, 3);
  assert.equal((await f.call('parent-b', 'bootstrap', {})).family.children[0].schoolGrade, 1);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId, i])), data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-6a-2024' } } });
  page.changeUnit({ detail: { value: 1 } });
  assert.equal(page.data.items.find(i => i.id === ids[1]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } }); assert.ok(!page.data.items.some(i => i.id === ids[1]));
});
