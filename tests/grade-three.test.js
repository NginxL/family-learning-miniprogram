const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/catalogs/shanghai-54-grade3.json');
const learning = require('../shared/learning');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('PEP five-four grade three retains 250 new and 250 writing characters per semester, excluding blue review positions', () => {
  const [a, b] = data.books;
  for (const [book, reviewCount, recognitionPages, writingPages] of [
    [a, 27, [109, 110, 111], [112, 113]], [b, 25, [111, 112, 113], [114, 115]]
  ]) {
    const newCharacters = [];
    for (const unit of book.units) {
      const characters = [...unit.recognition.join('')];
      for (const reviewed of unit.recognitionReviewCharacters) {
        assert.ok(characters.includes(reviewed)); characters.splice(characters.indexOf(reviewed), 1);
      }
      newCharacters.push(...characters);
      const mapping = learning.catalogById.get(`sh54-zh-3${book.semester === '上册' ? 'a' : 'b'}-${unit.id}-literacy`).gradeMappings[0];
      assert.equal(mapping.sourcePrintPage, unit.recognitionPrintPages[0]);
      assert.equal(mapping.sourcePdfPage, mapping.sourcePrintPage + 6);
      assert.equal(mapping.sourceKind, 'official_textbook');
    }
    assert.equal(newCharacters.length, 250); assert.equal(new Set(newCharacters).size, 250);
    assert.equal(book.units.flatMap(unit => unit.recognitionReviewCharacters).length, reviewCount);
    const written = book.units.flatMap(unit => unit.writing).join('');
    assert.equal(written.length, 250); assert.equal(new Set(written).size, 250);
    assert.deepEqual(book.sourceEvidence.recognitionPrintPages, recognitionPages);
    assert.deepEqual(book.sourceEvidence.writingPrintPages, writingPages);
    assert.equal(book.inventory.recognitionComplete, true); assert.equal(book.inventory.writingComplete, true);
  }
  assert.deepEqual(a.units.map(unit => unit.sourcePrintPage), [1, 13, 27, 45, 59, 69, 83, 95]);
  assert.deepEqual(b.units.map(unit => unit.sourcePrintPage), [1, 15, 33, 43, 57, 69, 83, 95]);
  assert.equal(a.units[0].recognition[0], '绒昂扬凤墙晃');
  assert.equal(b.units[7].recognition.at(-1), '咳嗽唠叨吆讽诫辩');
});

test('the observed author and opening line distinguish the 3B Jueju from the unmapped same-title 2B poem', () => {
  const poem = data.books[1].units[0].poems.find(item => item.contentId === 'moe-2022-zh-1-6-027');
  assert.deepEqual(poem.identityEvidence, { author: '杜甫', firstLine: '迟日江山丽', sourcePdfPage: 8 });
  const item = learning.catalogById.get(poem.contentId);
  assert.match(item.detail, /迟日江山丽/);
  assert.ok(item.gradeMappings.some(mapping => mapping.bookId === 'chinese-3b-sample' && /首句/.test(mapping.evidence)));
  assert.ok(!item.gradeMappings.some(mapping => mapping.bookId === 'chinese-2b-sample'));
  assert.equal(learning.searchCatalog({ kind: 'poetry', grade: 3, semester: '下册' }).length, 6);
});

test('English grade three keeps audio evidence, verified unit structure and the historical lower-semester edition explicit', () => {
  const [, , a, b] = data.books;
  assert.equal(a.sourceEvidence.officialResourceIsbn, '978-7-5720-4357-4');
  assert.equal(b.sourceEvidence.officialResourceIsbn, '978-7-5444-1650-4');
  assert.equal(a.units.length, 10); assert.equal(b.units.length, 12);
  assert.equal(a.units[3].title, 'Water');
  assert.equal(b.units[3].displayLabel, 'Module 2 / Unit 1 · Animals');
  assert.equal(b.editionStatus, 'historical_reference');
  for (const [book, count] of [[a, 158], [b, 61]]) {
    assert.equal(book.units.flatMap(unit => unit.words).length, count);
    assert.equal(book.inventory.vocabularyCount, count);
    assert.equal(book.inventory.wordBankComplete, false);
    for (const item of learning.searchCatalog({ bookId: book.id })) {
      const mapping = item.gradeMappings.find(mapping => mapping.bookId === book.id);
      assert.equal(mapping.sourceKind, 'official_audio');
      assert.equal(mapping.sourcePrintPage, undefined); assert.equal(mapping.sourcePdfPage, undefined);
      assert.match(mapping.outlineDestination, /\.mp3$/);
      if (book === b) assert.match(mapping.evidence, /旧版参考/);
    }
  }
  assert.ok(!a.units[9].words.some(word => word.text === 'flour'), 'audio homophones without paper evidence stay pending');
});

test('every new unit has usable original reading, questions and answers without claiming a full textbook', () => {
  for (const book of data.books) {
    assert.equal(book.schoolSystem, '5-4'); assert.equal(book.grade, 3);
    assert.equal(book.schoolAdoption, 'pending'); assert.equal(book.inventory.fullCoverage, false);
    for (const unit of book.units) {
      const items = learning.searchCatalog({ bookId: book.id, unitId: unit.id });
      const reading = items.find(item => item.kind === (book.subject === 'chinese' ? 'reading' : 'english-reading') && item.studyArea !== 'literacy');
      assert.ok(reading.detail.includes(unit.practice.body));
      assert.ok(reading.detail.includes(unit.practice.question)); assert.ok(reading.detail.includes(unit.practice.answer));
      assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
      if (book.subject === 'english') assert.equal(items.filter(item => item.kind === 'sentence').length, 4);
      else assert.ok(pinyinFor(reading));
    }
    assert.equal(learning.searchCatalog({ bookId: book.id, semester: book.semester === '上册' ? '下册' : '上册' }).length, 0);
  }
});

test('grade-three pinyin distinguishes contextual readings and does not apply tone-sandhi changes to unrelated characters', () => {
  const sounds = (id, char) => pinyinFor(learning.catalogById.get(id)).body.flat().filter(token => token.text === char).map(token => token.pinyin);
  assert.ok(sounds('sh54-zh-3b-u5-literacy', '系').includes('jì'));
  assert.deepEqual(sounds('sh54-zh-3a-u5-reading', '量'), ['liáng']);
  assert.ok(sounds('sh54-zh-3a-u7-reading', '落').every(value => value === 'luò'));
  assert.deepEqual(sounds('sh54-zh-3a-u4-reading', '干'), ['gān']);
  assert.ok(sounds('sh54-zh-3a-u8-reading', '地').every(value => value === 'de'));
  assert.ok(sounds('sh54-zh-3b-u3-reading', '只').every(value => value === 'zhī'));
  assert.ok(sounds('sh54-zh-3b-u3-reading', '长').every(value => value === 'cháng'));
  assert.deepEqual(sounds('sh54-zh-3b-u5-reading', '得'), ['děi']);
  assert.ok(sounds('sh54-zh-3a-u6-reading', '意').every(value => value === 'yì'));
  assert.ok(sounds('sh54-zh-3b-u4-reading', '艺').every(value => value === 'yì'));
});

test('grade-three content completes and syncs with existing IDs, learned badges and isolated textbook/practice progress', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-3b-u5-literacy', 'sh54-en-3b-u4-reading', 'word-bus'];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(24 * 60 * 60 * 1000);
  const a = f.client('parent-a'), b = f.client('parent-b');
  await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(item => item.contentId)), new Set(ids));
  const history = await b.engine.getHistory({ childId }); assert.equal(history.total, 3);
  assert.match(history.items.find(item => item.id === ids[0]).detail, /萝 卜/);
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[2].learned, 2); assert.equal(progress.grades[2].practice.learned, 1);
  assert.equal(progress.grades[2].fullGradeComplete, false);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(item => [item.contentId, item])),
    data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-3b-legacy' } } });
  page.changeUnit({ detail: { value: 4 } });
  const card = page.data.items.find(item => item.id === ids[1]);
  assert.equal(card.learnedLabel, '已学过'); assert.match(card.gradeLabel, /旧版参考/);
  page.changeLearningFilter({ detail: { value: 1 } });
  assert.ok(!page.data.items.some(item => item.id === ids[1]));
});
