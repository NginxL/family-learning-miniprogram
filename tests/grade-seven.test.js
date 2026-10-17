const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/catalogs/shanghai-54-grade7.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('seventh-grade books use verified five-four editions and separate six Chinese units from two appendices', () => {
  assert.deepEqual(data.books.map(b => b.semester), ['上册', '下册', '上册', '下册']);
  const contentIds = ['df82f043-281e-48ef-931a-34b951ae8c26', 'd08cae24-887e-45bd-8ccb-b56af508a293', '9dafb61c-5293-2faf-f0a1-59e20b43eaed', '5f72a1e5-6754-7c81-9759-b7f310b16263'];
  for (const [i, book] of data.books.entries()) {
    assert.equal(book.grade, 7); assert.equal(book.schoolSystem, '5-4');
    assert.equal(book.sourceKind, 'official_textbook'); assert.equal(book.schoolAdoption, 'pending');
    assert.equal(new URL(book.sourceUrl).searchParams.get('contentId'), contentIds[i]);
    assert.equal(book.sourceEvidence.coverAuditYear, 2024);
    assert.match(book.edition, /ISBN、版次及学校印次待确认/);
    assert.equal(book.inventory.fullCoverage, false);
    assert.match(book.sourceEvidence.transcriptionSha256, /^[a-f0-9]{64}$/);
    const slot = resources.curriculum.slots.find(s => s.contentBookId === book.id);
    assert.equal(slot.stage, 'junior'); assert.equal(slot.contentStatus, 'partial');
    assert.equal(learning.searchCatalog({ bookId: book.id, grade: 6 }).length, 0);
  }
  const [a, b] = data.books;
  assert.deepEqual(a.units.map(u => u.sourcePrintPage), [1,23,45,77,105,131,75,155]);
  assert.deepEqual(b.units.map(u => u.sourcePrintPage), [1,27,59,95,121,143,93,174]);
  for (const book of [a, b]) {
    assert.equal(book.units.length, 8);
    assert.ok(book.units.slice(6).every(u => u.displayLabel.startsWith('附录')));
    assert.ok(book.units.every(u => u.sourcePdfPage === u.sourcePrintPage + 7));
    assert.ok(!learning.searchCatalog({ bookId: book.id }).some(i => i.studyArea === 'literacy'));
  }
  assert.match(b.sourceEvidence.textLayerWarning, /残留旧版2016/);
  assert.ok(b.units[0].lessons.includes('列夫·托尔斯泰'));
  assert.ok(b.units[2].lessons.includes('山地回忆'));
  assert.ok(b.units[3].lessons.includes('有为有不为'));
  assert.ok(b.units[5].lessons.includes('“蛟龙”探海'));
  assert.ok(!b.units.flatMap(u => u.lessons).includes('叶圣陶先生二三事'));
});

test('all 533 seventh-grade English vocabulary positions retain exact pages and canonical spelling variants', () => {
  const [, , a, b] = data.books;
  for (const [book, counts, pages, offset] of [[a, [41,46,55,38,40,35], [141,142,143,144,145], 9], [b, [48,60,41,45,52,32], [129,130,131,132,133], 7]]) {
    assert.deepEqual(book.units.filter(u => u.number > 0).map(u => u.words.length), counts);
    assert.equal(book.inventory.vocabularyCount, counts.reduce((x, y) => x + y, 0));
    assert.equal(book.inventory.vocabularyListComplete, true);
    assert.deepEqual(book.sourceEvidence.vocabularyPrintPages, pages);
    for (const u of book.units) for (const w of u.words) {
      assert.ok(pages.includes(w.vocabularyPrintPage));
      assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + offset);
      const item = learning.searchCatalog({ bookId: book.id, unitId: u.id }).find(i => i.kind === 'word' && i.aliases.includes(w.text));
      assert.ok(item, `${book.id}/${u.id}/${w.text}`);
      assert.ok(item.gradeMappings.some(m => m.bookId === book.id && m.unitId === u.id && m.sourcePrintPage === w.vocabularyPrintPage));
    }
  }
  assert.equal(a.inventory.vocabularyCount + b.inventory.vocabularyCount, 533);
  assert.equal(a.units[0].displayLabel, '预备篇 · Starter'); assert.equal(a.units[0].words.length, 0);
  assert.equal(a.units[3].words.find(w => w.text === 'actor').textbookForm, 'actor / actress');
  assert.ok(learning.catalogById.get('word-actor').gradeMappings.some(m => m.bookId === a.id));
  assert.equal(b.units[3].words.find(w => w.text === 'practice').textbookForm, 'practise (AmE practice)');
  assert.ok(!learning.catalogById.has('sh54-word-practise'));
  const rock = learning.catalogById.get('word-rock');
  assert.match(rock.detail, /轻摇/); assert.match(rock.detail, /摇滚乐/);
  assert.ok(rock.gradeMappings.some(m => m.bookId === a.id && m.unitId === 'u4'));
  assert.ok(rock.gradeMappings.some(m => m.bookId === b.id && m.unitId === 'u1'));
});

test('38 verified poem locations preserve IDs, rare characters and compilation-era distinctions', () => {
  const maps = data.books.slice(0, 2).flatMap(book => book.units.flatMap(u => u.poems.map(p => ({ book, u, p }))));
  assert.equal(maps.length, 38); assert.equal(data.poems.length, 21);
  for (const { book, u, p } of maps) {
    const item = learning.catalogById.get(p.contentId);
    assert.equal(item.author, p.identityEvidence.author); assert.ok(item.detail.includes(p.identityEvidence.firstLine));
    const actual = item.gradeMappings.filter(m => m.bookId === book.id);
    assert.equal(actual.length, 1); assert.equal(actual[0].unitId, u.id);
    assert.equal(actual[0].sourcePrintPage, p.sourcePrintPage); assert.equal(actual[0].sourcePdfPage, p.sourcePrintPage + 7);
  }
  for (const [id, fragment] of [['moe-2022-zh-7-9-011', '随君直到夜郎西'], ['moe-2022-zh-7-9-006', '唯闻女叹息'], ['sh54-guosongyuan', '政入万山围子里'], ['sh54-maiyouweng', '徐以杓酌油沥之'], ['sh54-huoban', '用讫再火令药镕'], ['sh54-qiren-youtian', '若躇步跐蹈']]) assert.ok(learning.catalogById.get(id).detail.includes(fragment));
  assert.equal(learning.catalogById.get('sh54-sunquan-quanxue').dynasty, '北宋');
  assert.match(learning.catalogById.get('sh54-sunquan-quanxue').dynastyNote, /编纂时代/);
  assert.equal(learning.catalogById.get('sh54-yongxue').dynasty, '南朝·宋');
  assert.match(learning.catalogById.get('sh54-qiren-youtian').dynastyNote, /成书时代有争议/);
});

test('all 29 seventh-grade groups offer readable original exercises with questions, answers and grammar or pinyin', () => {
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
  const p = learning.progress({ records: {} }).grades[6];
  assert.equal(p.stage, '初中'); assert.equal(p.total, 569); assert.equal(p.practice.total, 132); assert.equal(p.fullGradeComplete, false);
});

test('existing variant records and learned shared words remain compatible with seventh-grade planning', () => {
  const source = learning.catalogById.get('moe-2022-zh-7-9-011');
  const old = { ...learning.taskFrom(source, 'child', 'old-task', 'new'), detail: source.detail.replace('随君', '随风'), done: true };
  const ledger = { records: {} }; learning.recordTasks(ledger, [old], '2026-10-12');
  assert.equal(learning.history(ledger, {}).items[0].id, source.id);
  assert.equal(learning.progress(ledger).grades[6].learned, 1);
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(r => r.kind === 'poetry' ? { ...r, quantity: 10, scope: 'all' } : r) } };
  assert.ok(!learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: ledger }).tasks.some(t => t.contentId === source.id));
  for (const id of ['word-practice', 'word-actor', 'word-rock', 'word-tie', 'sh54-advice-son', 'moe-2022-zh-7-9-041']) assert.ok(learning.catalogById.has(id));
});

test('seventh-grade records sync after lost responses and appear as learned in the library without changing school grade', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'updateChild', { ...base, name: family.children[0].name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-7b-u8-reading', 'sh54-en-7a-u0-reading', 'sh54-en-7b-u3-reading', 'word-rock', 'sh54-sunquan-quanxue'];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[6].learned, 2); assert.equal(progress.grades[6].practice.learned, 3);
  assert.equal((await f.call('parent-b', 'bootstrap', {})).family.children[0].schoolGrade, 1);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId, i])), data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-7a-2024' } } });
  page.changeUnit({ detail: { value: 1 } });
  assert.equal(page.data.items.find(i => i.id === ids[1]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } }); assert.ok(!page.data.items.some(i => i.id === ids[1]));
});
