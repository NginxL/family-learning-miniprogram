const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const data = require('../data/catalogs/shanghai-54-grade8.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');
const groupId = 'moe-2022-zh-7-9-043';
const chapterIds = ['sh54-mengzi-dedao', 'sh54-mengzi-youhuan'];
const family = () => ({ children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(r => r.kind === 'poetry' ? { ...r, quantity: 5, scope: 'all' } : r) } });
const done = (id, date, ledger) => learning.recordTasks(ledger, [{ ...learning.taskFrom(learning.catalogById.get(id), 'child', id, 'new'), done: true }], date);

test('eighth-grade books match the four five-four original editions, exact unit starts and appendices', () => {
  const ids = ['c8b697f9-6a7a-4057-85ef-7651f68aa91e', '03491549-8712-48a3-8fc8-5a616e6f492e', 'dbfcba4a-fe4e-1693-0c18-cabaccfe81cb', 'a5e66ba2-d435-9e52-1dc4-0034467293d2'];
  for (const [i, b] of data.books.entries()) {
    assert.equal(b.grade, 8); assert.equal(b.schoolSystem, '5-4');
    assert.equal(b.sourceKind, 'official_textbook'); assert.equal(b.schoolAdoption, 'pending');
    assert.equal(new URL(b.sourceUrl).searchParams.get('contentId'), ids[i]);
    assert.equal(b.sourceEvidence.coverAuditYear, 2024);
    assert.equal(b.sourceEvidence.totalPdfPages, [174, 167, 162, 154][i]);
    assert.match(b.edition, /ISBN、版次及学校印次待确认/);
    assert.equal(b.inventory.fullCoverage, false);
    assert.match(b.sourceEvidence.transcriptionSha256, /^[a-f0-9]{64}$/);
    const slot = resources.curriculum.slots.find(s => s.contentBookId === b.id);
    assert.equal(slot.stage, 'junior'); assert.equal(slot.contentStatus, 'partial');
    assert.equal(learning.searchCatalog({ bookId: b.id, grade: 7 }).length, 0);
    assert.ok(b.units.every(u => u.sourcePdfPage === u.sourcePrintPage + 7));
  }
  assert.deepEqual(data.books[0].units.map(u => u.sourcePrintPage), [1,23,61,83,107,143,81,163]);
  assert.deepEqual(data.books[1].units.map(u => u.sourcePrintPage), [1,29,61,83,109,133,81,156]);
  for (const b of data.books.slice(0, 2)) {
    assert.ok(b.units.slice(6).every(u => u.displayLabel.startsWith('附录')));
    assert.ok(!learning.searchCatalog({ bookId: b.id }).some(i => i.studyArea === 'literacy'));
  }
  for (const b of data.books.slice(2)) assert.deepEqual(b.units.map(u => u.sourcePrintPage), [2,18,34,50,66,82]);
  assert.ok(data.books[0].units[0].lessons.includes('中国人首次进入自己的空间站'));
  assert.ok(data.books[1].units[1].lessons.includes('月亮是从哪里来的'));
});

test('all 468 eighth-grade vocabulary positions have verified word-head pages and preserve earlier word identities', () => {
  const [, , a, b] = data.books;
  for (const [book, counts, pages] of [[a, [45,55,29,50,41,40], [134,135,136,137,138,139]], [b, [29,32,44,24,46,33], [129,130,131,132]]]) {
    assert.deepEqual(book.units.map(u => u.words.length), counts);
    assert.equal(book.inventory.vocabularyCount, counts.reduce((x, y) => x + y, 0));
    assert.equal(book.inventory.vocabularyListComplete, true);
    for (const u of book.units) for (const w of u.words) {
      assert.ok(pages.includes(w.vocabularyPrintPage)); assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + 7);
      const item = learning.searchCatalog({ bookId: book.id, unitId: u.id }).find(i => i.kind === 'word' && i.aliases.includes(w.text));
      assert.ok(item, `${book.id}/${u.id}/${w.text}`);
      assert.ok(item.gradeMappings.some(m => m.bookId === book.id && m.unitId === u.id && m.sourcePrintPage === w.vocabularyPrintPage));
      assert.ok(item.detail.includes(w.meaning.split('；')[0]));
    }
  }
  assert.equal(a.inventory.vocabularyCount + b.inventory.vocabularyCount, 468);
  assert.equal(a.units[0].words.find(w => w.text === 'litre').textbookForm, 'litre (AmE liter)');
  assert.equal(b.units[3].words.find(w => w.text === 'jewellery').textbookForm, 'jewellery (AmE jewelry)');
  assert.equal(b.units[4].words.find(w => w.text === 'towards').textbookForm, 'towards (AmE toward)');
  assert.equal(a.units[1].words.find(w => w.text === 'laptop').vocabularyPrintPage, 134, 'page records the headword, not its continued definition');
  assert.ok(a.units[4].words.some(w => w.text === 'ASAP'));
  assert.ok(b.units[4].words.some(w => w.text === 'Rd'));
  assert.match(learning.catalogById.get('word-mine').detail, /矿井/);
  assert.match(learning.catalogById.get('word-record').detail, /唱片/);
  assert.ok(learning.catalogById.get('word-miss').gradeMappings.some(m => m.bookId === a.id));
  assert.notEqual(learning.catalogById.get('word-title-miss'), learning.catalogById.get('word-miss'));
});

test('48 eighth-grade ancient-text locations retain exact work identity, variants and author eras', () => {
  const maps = data.books.slice(0, 2).flatMap(book => book.units.flatMap(u => u.poems.map(p => ({ book, u, p }))));
  assert.equal(maps.length, 48); assert.equal(data.poems.length, 26);
  for (const { book, u, p } of maps) {
    const item = learning.catalogById.get(p.contentId);
    if (p.contentId === 'moe-2022-zh-7-9-005') assert.match(p.textVariantNote, /陶潜/);
    else assert.equal(item.author, p.identityEvidence.author);
    assert.ok(item.detail.includes(p.identityEvidence.firstLine));
    const actual = item.gradeMappings.filter(m => m.bookId === book.id);
    assert.equal(actual.length, 1); assert.equal(actual[0].unitId, u.id);
    assert.equal(actual[0].sourcePrintPage, p.sourcePrintPage); assert.equal(actual[0].sourcePdfPage, p.sourcePrintPage + 7);
  }
  for (const [id, fragment] of [['moe-2022-zh-7-9-050', '五色交晖'], ['moe-2022-zh-7-9-028', '几时回！'], ['moe-2022-zh-7-9-052', '只辱于奴隶人之手'], ['moe-2022-zh-7-9-019', '半匹红纱一丈绫'], ['sh54-ti-poshansi', '竹径通幽处'], ['sh54-hezhouji', '诎右臂支船'], ['sh54-zhuangzi-haoliang', '鲦鱼'], ['sh54-mengzi-youhuan', '故天将降大任于是人也']]) assert.ok(learning.catalogById.get(id).detail.includes(fragment), id);
  assert.equal(learning.catalogById.get('sh54-hezhouji').dynasty, '明代');
  assert.equal(learning.catalogById.get('sh54-hezhouji').author, '魏学洢');
  assert.match(learning.catalogById.get('sh54-dadao-zhixing').dynastyNote, /编纂时代/);
  assert.match(learning.catalogById.get('sh54-yugong-yishan').dynastyNote, /争议/);
  assert.ok(!learning.catalogById.get(groupId).gradeMappings.some(m => m.grade === 8));
  assert.equal(learning.catalogById.get('moe-2022-zh-7-9-032').author, '李清照');
});

test('28 eighth-grade groups provide original reading, aligned questions and grammar or static pinyin', () => {
  assert.equal(data.books.reduce((n, b) => n + b.units.length, 0), 28);
  for (const b of data.books) for (const u of b.units) {
    const items = learning.searchCatalog({ bookId: b.id, unitId: u.id });
    const reading = items.find(i => i.kind === (b.subject === 'chinese' ? 'reading' : 'english-reading'));
    for (const value of [u.practice.body, u.practice.question, u.practice.answer]) assert.ok(reading.detail.includes(value));
    assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
    if (b.subject === 'chinese') { assert.ok(u.practice.body.length >= 140); assert.ok(pinyinFor(reading)); }
    else {
      assert.equal(u.practice.translation.length, 6); assert.equal(items.filter(i => i.kind === 'sentence').length, 6);
      assert.ok(reading.detail.includes(u.practice.grammar)); assert.match(reading.detail, /1\..*\n2\..*\n3\./);
    }
  }
  const p = learning.progress({ records: {} }).grades[7];
  assert.equal(p.total, 516); assert.equal(p.practice.total, 100); assert.equal(p.fullGradeComplete, false);
});

test('all earlier IDs survive, while grouped Mengzi chapters do not change old snapshots or invent mastery', () => {
  const poems = new Set([...data.poems, ...require('../data/catalogs/shanghai-54-grade9.json').poems].map(p => p.id));
  const current = require('../shared/knowledge-data.json');
  // flour was added after ninth grade when the third-grade paper list became readable.
  const oldIds = current.filter(i => i.id !== 'sh54-word-flour' && !poems.has(i.id) && !/^sh54-(zh|en)-[89][ab]-/.test(i.id)
    && !(i.id.startsWith('sh54-word-') && i.gradeMappings.every(m => m.grade >= 8))).map(i => i.id).sort();
  assert.equal(oldIds.length, 3395);
  assert.equal(crypto.createHash('sha256').update(oldIds.join('\n')).digest('hex'), 'c48c20847812c3244671fd5c8eb66bd31cc9785e8a1ab958c22a39a8dc593809');
  const parent = learning.catalogById.get(groupId), ledger = { records: {} };
  const old = { ...learning.taskFrom(parent, 'child', 'legacy', 'new'), detail: parent.detail.replace('故曰：', '故曰，'), done: true };
  const before = structuredClone(old); learning.recordTasks(ledger, [old], '2026-10-12');
  const status = learning.learningStatus(ledger).items;
  assert.deepEqual(new Set(status.map(i => i.contentId)), new Set([groupId, ...parent.coveredContentIds]));
  assert.equal(learning.progress(ledger).grades[7].learned, 2);
  assert.equal(learning.progress(ledger).grades[7].mastered, 0);
  assert.ok(!status.some(i => i.contentId === 'sh54-mengzi-fugui'));
  assert.deepEqual(Object.keys(ledger.records), [groupId]); assert.deepEqual(old, before);
  assert.equal(learning.history(ledger).items.length, 1);
  for (const id of chapterIds) assert.equal(learning.wasLearned(ledger, learning.catalogById.get(id)), true);
  const shortened = structuredClone(ledger); shortened.records[groupId].item = { ...learning.content(parent), detail: learning.catalogById.get(chapterIds[0]).detail };
  assert.ok(!learning.learningStatus(shortened).items.some(i => i.contentId === chapterIds[1]));
  const other = { records: {} }; done(chapterIds[0], '2026-10-12', other);
  assert.equal(learning.wasLearned(other, learning.catalogById.get(chapterIds[1])), false);
  assert.equal(learning.wasLearned(other, parent), true, 'a partly studied group cannot be wholly new again');
  assert.ok(!learning.learningStatus(other).items.some(i => i.contentId === groupId));
  done(chapterIds[0], '2026-10-12', ledger);
  assert.equal(learning.learningStatus(ledger).items.find(i => i.contentId === chapterIds[0]).learnedCount, 1, 'the same date is not double-counted');
});

test('new planning filters completed group chapters, keeps independent chapters and preserves old completed tasks', () => {
  const ledger = { records: {} }; done(groupId, '2026-10-12', ledger);
  for (const item of learning.catalog.filter(i => i.kind === 'poetry' && i.id !== groupId && !chapterIds.includes(i.id) && i.id !== 'sh54-mengzi-fugui'))
    learning.recordTasks(ledger, [learning.taskFrom(item, 'child', item.id, 'new')], '2026-10-12');
  const tasks = learning.generateDay(family(), { date: '2026-10-13', tasks: [] }, { child: ledger }).tasks;
  assert.deepEqual(tasks.map(t => t.contentId), ['sh54-mengzi-fugui']);
  const ledger2 = { records: {} };
  for (const item of learning.catalog.filter(i => i.kind === 'poetry' && i.id !== groupId && !chapterIds.includes(i.id)))
    learning.recordTasks(ledger2, [learning.taskFrom(item, 'child', item.id, 'new')], '2026-10-12');
  done(chapterIds[0], '2026-10-12', ledger2);
  assert.deepEqual(learning.generateDay(family(), { date: '2026-10-13', tasks: [] }, { child: ledger2 }).tasks.map(t => t.contentId), [chapterIds[1]]);
  const oldDay = { date: '2026-10-12', tasks: [groupId, ...chapterIds].map(id => ({ ...learning.taskFrom(learning.catalogById.get(id), 'child', id, 'new'), done: true })) };
  const snapshots = structuredClone(oldDay.tasks);
  learning.generateDay(family(), oldDay, { child: ledger }, true);
  for (const task of snapshots) assert.deepEqual(oldDay.tasks.find(t => t.id === task.id), task);
});

test('shared ledger capacity supports the expanded catalogue plus reviews and rejects oversized writes without mutation', () => {
  const { LEDGER_MAX_BYTES, requireLedgerCapacity } = require('../cloudfunctions/familyApi/validation');
  const ledger = { records: {} }; const tasks = learning.catalog.map((i, n) => ({ ...learning.taskFrom(i, 'child', `t${n}`, 'new'), done: true }));
  for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) learning.recordTasks(ledger, tasks, date);
  assert.ok(Buffer.byteLength(JSON.stringify(ledger)) < LEDGER_MAX_BYTES);
  assert.doesNotThrow(() => requireLedgerCapacity(ledger));
  const oversized = { records: { custom: { item: { id: 'custom', kind: 'reading', detail: '字'.repeat(LEDGER_MAX_BYTES) }, completedDates: ['2026-10-12'] } } };
  const before = JSON.stringify(oversized);
  assert.throws(() => requireLedgerCapacity(oversized), { code: 'LIMIT' });
  assert.equal(JSON.stringify(oversized), before);
});

test('eighth-grade work syncs after a lost response and library marks it learned without changing school grade', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'updateChild', { ...base, name: family.children[0].name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-8b-u8-reading', 'sh54-en-8a-u2-reading', 'sh54-en-8b-u6-reading', 'word-mine', 'sh54-hezhouji'];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[7].learned, 2); assert.equal(progress.grades[7].practice.learned, 3);
  assert.equal((await f.call('parent-b', 'bootstrap', {})).family.children[0].schoolGrade, 1);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId, i])), data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-8a-2024' } } });
  page.changeUnit({ detail: { value: 2 } }); page.loadMore(); page.loadMore();
  assert.equal(page.data.items.find(i => i.id === ids[1]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } }); assert.ok(!page.data.items.some(i => i.id === ids[1]));
});
