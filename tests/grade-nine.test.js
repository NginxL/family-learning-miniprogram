const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const data = require('../data/catalogs/shanghai-54-grade9.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const done = (ledger, id, date = '2026-10-12') => learning.recordTasks(ledger,
  [{ ...learning.taskFrom(learning.catalogById.get(id), 'child', id, 'new'), done: true }], date);

test('ninth-grade editions retain the observed five-four sources and distinguish historical lower volumes', () => {
  const ids = ['d6941a82-0aa3-4c6c-a198-b95ea84a6852', 'ab06a72c-93e6-4135-b549-900db6783fa9', '1dcc5207-c993-09a4-09a8-079686747f38'];
  for (const [i, b] of data.books.entries()) {
    assert.equal(b.grade, 9); assert.equal(b.schoolSystem, '5-4'); assert.equal(b.schoolAdoption, 'pending');
    assert.equal(b.inventory.fullCoverage, false);
    const slot = resources.curriculum.slots.find(s => s.contentBookId === b.id);
    assert.equal(slot.stage, 'junior'); assert.equal(slot.contentStatus, 'partial');
    assert.equal(learning.searchCatalog({ bookId: b.id, grade: 8 }).length, 0);
    if (i < 3) {
      assert.equal(new URL(b.sourceUrl).searchParams.get('contentId'), ids[i]);
      assert.equal(b.sourceKind, 'official_textbook');
      assert.equal(b.sourceEvidence.totalPdfPages, [170, 158, 158][i]);
      assert.equal(b.sourceEvidence.coverAuditYear, [2024, 2019, 2024][i]);
      assert.match(b.sourceEvidence.transcriptionSha256, /^[a-f0-9]{64}$/);
      assert.ok(b.units.every(u => u.sourcePdfPage === u.sourcePrintPage + 7));
    }
  }
  assert.deepEqual(data.books[0].units.map(u => u.sourcePrintPage), [1,21,49,67,111,135,65,159]);
  assert.deepEqual(data.books[1].units.map(u => u.sourcePrintPage), [1,17,47,71,97,123,69,147]);
  assert.deepEqual(data.books[2].units.map(u => u.sourcePrintPage), [2,18,34,50,66,82]);
  for (const b of data.books.slice(0, 2)) assert.ok(b.units.slice(6).every(u => u.displayLabel.startsWith('附录')));
  for (const b of [data.books[1], data.books[3]]) {
    assert.equal(b.editionStatus, 'historical_reference');
    assert.match(b.edition, /新版下册待核实|新版下册、/);
  }
  assert.equal(data.books[3].sourceEvidence.officialResourceCode, '54441665');
  assert.equal(data.books[3].sourceEvidence.officialResourceIsbn, '978-7-5444-1665-8');
});

test('199 ninth-grade upper-volume words have original page evidence; 159 audio words are explicitly a partial old-edition selection', () => {
  const a = data.books[2], b = data.books[3];
  assert.deepEqual(a.units.map(u => u.words.length), [35,32,40,25,37,30]);
  assert.deepEqual(b.units.map(u => u.words.length), [36,27,35,30,31]);
  assert.equal(a.inventory.vocabularyListComplete, true); assert.equal(a.inventory.vocabularyCount, 199);
  assert.equal(b.inventory.vocabularyListComplete, false); assert.equal(b.inventory.vocabularyCount, 159);
  assert.equal(b.sourceEvidence.wordBankPrintedPagesVerified, false);
  assert.equal(b.sourceEvidence.audioFiles.length, 4);
  assert.ok(b.sourceEvidence.audioFiles.every(f => /^[a-f0-9]{32}$/.test(f.md5) && /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.equal(b.sourceEvidence.excludedUncertainForms.length, 2);
  assert.deepEqual(b.units.map(u => u.sourcePrintPage), [3,21,39,55,73]);
  for (const book of [a, b]) for (const u of book.units) for (const w of u.words) {
    const item = learning.searchCatalog({ bookId: book.id, unitId: u.id }).find(i => i.kind === 'word' && i.aliases.includes(w.text));
    assert.ok(item, `${book.id}/${u.id}/${w.text}`);
    assert.ok(item.detail.includes(w.meaning.split('；')[0]));
    const mapping = item.gradeMappings.find(m => m.bookId === book.id && m.unitId === u.id);
    if (book === a) {
      assert.ok([132,133,134,135,136].includes(w.vocabularyPrintPage));
      assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + 7);
      assert.equal(mapping.sourcePrintPage, w.vocabularyPrintPage);
    } else {
      assert.equal(w.vocabularyPdfPage, undefined); assert.equal(mapping.sourcePdfPage, undefined);
      assert.equal(mapping.sourceKind, 'official_audio'); assert.match(mapping.evidence, /旧版参考/);
      assert.match(mapping.evidence, /纸本.*待确认/);
    }
  }
  for (const [uk, us] of [['behavioural','behavioral'], ['organise','organize'], ['digitalisation','digitalization'], ['honour','honor']])
    assert.equal(a.units.flatMap(u => u.words).find(w => w.text === uk).textbookForm, `${uk} (AmE ${us})`);
  assert.ok(!b.units.flatMap(u => u.words).some(w => ['make up', 'make-up', 'compare to', 'compared to'].includes(w.text)));
});

test('47 ancient-text locations preserve text scope, variants, author eras and same-title identities', () => {
  assert.equal(data.poems.length, 19);
  assert.deepEqual(data.books.slice(0,2).map(b => b.units.flatMap(u => u.poems).length), [23,24]);
  for (const book of data.books.slice(0,2)) for (const u of book.units) for (const p of u.poems) {
    const item = learning.catalogById.get(p.contentId);
    assert.ok(item.detail.includes(p.identityEvidence.firstLine));
    if (p.contentId === 'moe-2022-zh-7-9-003') assert.equal(p.identityEvidence.author, '《乐府诗集》');
    else assert.equal(item.author, p.identityEvidence.author);
    const maps = item.gradeMappings.filter(m => m.bookId === book.id);
    assert.equal(maps.length, 1); assert.equal(maps[0].sourcePrintPage, p.sourcePrintPage);
    assert.equal(maps[0].sourcePdfPage, p.sourcePrintPage + 7); assert.equal(maps[0].unitId, u.id);
  }
  for (const [id, fragment] of [['moe-2022-zh-7-9-055','霪雨霏霏'], ['moe-2022-zh-7-9-042','小惠未遍'],
    ['moe-2022-zh-7-9-003','不知饴阿谁'], ['sh54-chenshe-shijia','发闾左適戍渔阳']])
    assert.ok(learning.catalogById.get(id).detail.includes(fragment));
  assert.equal(learning.catalogById.get('sh54-chenshe-shijia').gradeMappings.filter(m => m.grade === 9).length, 2);
  assert.match(learning.catalogById.get('sh54-tangju-buru').dynastyNote, /编订时代/);
  assert.deepEqual(['moe-2022-zh-7-9-028','sh54-huanxisha-qinguan','sh54-huanxisha-nalan']
    .map(id => learning.catalogById.get(id).author), ['晏殊','秦观','纳兰性德']);
});

test('27 ninth-grade groups provide original reading and usable questions, answers, translations and pinyin', () => {
  assert.equal(data.books.reduce((n,b) => n + b.units.length, 0), 27);
  for (const book of data.books) for (const u of book.units) {
    const items = learning.searchCatalog({ bookId: book.id, unitId: u.id });
    const reading = items.find(i => i.kind === (book.subject === 'chinese' ? 'reading' : 'english-reading'));
    assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
    for (const value of [u.practice.body, u.practice.question, u.practice.answer]) assert.ok(reading.detail.includes(value));
    if (book.subject === 'chinese') { assert.ok(u.practice.body.length >= 140); assert.ok(pinyinFor(reading)); }
    else {
      assert.equal(u.practice.translation.length, 6); assert.equal(items.filter(i => i.kind === 'sentence').length, 6);
      assert.ok(reading.detail.includes(u.practice.grammar)); assert.match(reading.detail, /1\..*\n2\..*\n3\./);
    }
  }
  const progress = learning.progress({ records: {} }).grades[8];
  assert.equal(progress.total, 386); assert.equal(progress.practice.total, 110); assert.equal(progress.fullGradeComplete, false);
});

test('all 3733 earlier IDs and national excerpts survive; full-text credit is never inferred from an excerpt', () => {
  const poems = new Set(data.poems.map(p => p.id));
  const oldIds = require('../shared/knowledge-data.json').filter(i => !i.learningArea && i.id !== 'sh54-word-flour' && !poems.has(i.id) && !/^sh54-(zh|en)-9[ab]-/.test(i.id)
    && !(i.id.startsWith('sh54-word-') && i.gradeMappings.every(m => m.grade === 9))).map(i => i.id).sort();
  assert.equal(oldIds.length, 3733); assert.equal(hash(oldIds.join('\n')), '66c7d944946323fca1ba3cb71c54aef9f04a7527fe9fef85b8a5a9b2f03ef605');
  const excerptId = 'moe-2022-zh-7-9-059', fullId = 'sh54-songdongyang-textbook', groupId = 'moe-2022-zh-7-9-043';
  assert.equal(hash(require('./chinese-baseline-helper').beforeChineseCorrections(learning.catalogById.get(excerptId)).detail), '8622ee12e9ccd7e4ad2e425fe05a06e12bae9bd3a4f7960e199dd6221187a7a8');
  assert.equal(hash(learning.catalogById.get(groupId).detail), 'b8a35d18f71f3611e416b7e3407cc90aae5fcffd24f1e0bc7bce5071f9cf2a64');
  const ledger = { records: {} }; done(ledger, excerptId); ledger.records[excerptId].mastered = true;
  const before = structuredClone(ledger);
  assert.ok(!learning.learningStatus(ledger).items.some(i => i.contentId === fullId));
  assert.equal(learning.progress(ledger).grades[8].learned, 0);
  assert.deepEqual(ledger, before);
  // Partly studied full texts are not wholly new, but remain independently assignable as review.
  assert.equal(learning.wasLearned(ledger, learning.catalogById.get(fullId)), true);
  const complete = { records: {} }; done(complete, fullId);
  const statuses = learning.learningStatus(complete).items;
  assert.deepEqual(new Set(statuses.map(i => i.contentId)), new Set([fullId, excerptId]));
  assert.ok(statuses.every(i => !i.mastered)); assert.deepEqual(Object.keys(complete.records), [fullId]);
  assert.equal(learning.history(complete).items.length, 1);
  done(complete, excerptId); assert.equal(learning.learningStatus(complete).items.find(i => i.contentId === excerptId).learnedCount, 1);
  const grouped = { records: {} }; done(grouped, groupId);
  assert.equal(learning.learningStatus(grouped).items.find(i => i.contentId === 'sh54-mengzi-yuwosuoyu').learnedCount, 1);
  assert.equal(learning.history(grouped).items.length, 1);
});

test('previously learned ninth-grade work is filtered from new plans without rewriting old completed snapshots', () => {
  const ledger = { records: {} }, id = 'moe-2022-zh-7-9-042';
  const old = { ...learning.taskFrom(learning.catalogById.get(id), 'child', 'old', 'new'), done: true };
  old.detail = old.detail.replace('小惠未遍','小惠未徧');
  const snapshot = structuredClone(old); learning.recordTasks(ledger, [old], '2026-10-12');
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(r => r.kind === 'poetry' ? { ...r, quantity: 5, scope: 'all' } : r) } };
  for (const item of learning.catalog.filter(i => i.kind === 'poetry')) done(ledger, item.id);
  assert.equal(learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: ledger }).tasks.length, 0);
  const oldDay = { date: '2026-10-12', tasks: [old] }; learning.generateDay(family, oldDay, { child: ledger }, true);
  assert.deepEqual(oldDay.tasks.find(t => t.id === 'old'), snapshot);
});

test('ninth-grade work syncs after a lost response and the library shows learned content independently of school grade', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a','updateChild',{ ...base, name: family.children[0].name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await f.call('parent-a','saveAutoPlans',{ ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-9b-u8-reading','sh54-en-9a-u2-reading','sh54-en-9b-u5-reading','word-stress','sh54-huanxisha-qinguan'];
  for (const contentId of ids) await f.call('parent-a','assignContent',{ ...base, contentId, date });
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date,task.id,true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  const progress = await f.call('parent-b','getProgress',base);
  assert.equal(progress.grades[8].learned, 2); assert.equal(progress.grades[8].practice.learned, 3);
  assert.equal((await f.call('parent-b','bootstrap',{})).family.children[0].schoolGrade, 1);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId,i])),
    data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data,patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-9a-2024' } } }); page.changeUnit({ detail: { value: 2 } });
  page.loadMore(); page.loadMore();
  assert.equal(page.data.items.find(i => i.id === ids[1]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } }); assert.ok(!page.data.items.some(i => i.id === ids[1]));
});
