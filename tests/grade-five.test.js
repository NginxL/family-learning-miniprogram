const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/catalogs/shanghai-54-grade5.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('grade-five Chinese uses actual five-four pages, complete character inventories and explicit edition boundaries', () => {
  const [a, b] = data.books;
  assert.match(a.edition, /2024/); assert.equal(a.sourceKind, 'official_textbook');
  assert.match(a.sourceEvidence.sidebarMismatch, /以PDF电子页4—5为准/);
  assert.deepEqual(a.units[0].lessons, ['桂花雨', '落花生', '珍珠鸟']);
  assert.deepEqual(a.units.map(u => u.sourcePrintPage), [1, 13, 33, 51, 65, 75, 91, 101]);
  assert.equal(b.editionStatus, 'historical_reference'); assert.equal(b.sourceKind, 'public_sample');
  assert.deepEqual(b.units.map(u => u.sourcePrintPage), [1, 19, 43, 59, 73, 83, 97, 109, 123]);
  assert.equal(b.units[8].displayLabel, '古诗词诵读（附录）');
  for (const [book, reviews, writingCount, recognitionPages, writingPages] of [
    [a, 9, 220, [115, 116, 117], [118, 119]], [b, 13, 200, [133, 134], [135, 136]]
  ]) {
    const newChars = [];
    for (const u of book.units) {
      const chars = [...u.recognition.join('')];
      for (const ch of u.recognitionReviewCharacters) { assert.ok(chars.includes(ch)); chars.splice(chars.indexOf(ch), 1); }
      newChars.push(...chars);
      for (const type of ['recognition', 'writing']) {
        assert.deepEqual(u[type + 'PdfPages'], u[type + 'PrintPages'].map(p => p + 5));
        u[type].forEach((row, i) => assert.equal([...row].length, u[type + 'Reading'][i].split(' ').length));
      }
    }
    assert.equal(newChars.length, 200); assert.equal(new Set(newChars).size, 200);
    assert.equal(book.units.flatMap(u => u.recognitionReviewCharacters).length, reviews);
    const written = book.units.flatMap(u => u.writing).join('');
    assert.equal(written.length, writingCount); assert.equal(new Set(written).size, writingCount);
    assert.deepEqual(book.sourceEvidence.recognitionPrintPages, recognitionPages);
    assert.deepEqual(book.sourceEvidence.writingPrintPages, writingPages);
    assert.match(book.sourceEvidence.transcriptionSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(learning.catalogById.has('sh54-zh-5b-u8-literacy'), false);
  assert.equal(learning.catalogById.has('sh54-zh-5b-u9-literacy'), false);
  assert.match(resources.curriculum.slots.find(s => s.contentBookId === b.id).contentNote, /8 个单元＋古诗词诵读附录/);
});

test('35 grade-five poetry locations preserve canonical identities and distinguish same-title poems and excerpts', () => {
  assert.equal(data.poems.length, 15);
  const locations = data.books.slice(0, 2).flatMap(book => book.units.flatMap(unit => (unit.poems || []).map(p => ({ book, p }))));
  assert.equal(locations.length, 35);
  for (const { book, p } of locations) {
    const item = learning.catalogById.get(p.contentId);
    assert.ok(item.detail.includes(p.identityEvidence.firstLine));
    assert.equal(item.author, p.identityEvidence.author);
    assert.equal(p.sourcePdfPage, p.sourcePrintPage + 5);
    assert.equal(item.gradeMappings.filter(m => m.bookId === book.id).length, 1);
    if (book.sourceKind === 'public_sample') assert.match(item.gradeMappings.find(m => m.bookId === book.id).evidence, /公开教材样本/);
  }
  assert.equal(learning.searchCatalog({ grade: 5, kind: 'poetry' }).length, 33);
  assert.equal(learning.catalogById.get('moe-2022-zh-1-6-034').gradeMappings.filter(m => m.grade === 5).length, 2);
  assert.match(learning.catalogById.get('moe-2022-zh-1-6-074').gradeMappings.find(m => m.grade === 5).evidence, /降人材/);
  assert.equal(learning.catalogById.get('moe-2022-zh-7-9-039').gradeMappings.some(m => m.grade === 5), false);
  assert.equal(learning.catalogById.get('sh54-huanxisha-sushi').author, '苏轼');
  assert.equal(learning.catalogById.get('sh54-qingpingle-huang').author, '黄庭坚');
  assert.equal(learning.catalogById.get('sh54-yangshi-zhizi').dynasty, '南朝宋');
  assert.match(learning.catalogById.get('sh54-caiwei-excerpt').note, /节选/);
});

test('grade-five English separates complete printed Words to use from lower-semester historical audio', () => {
  const [, , a, b] = data.books;
  assert.equal(a.sourceEvidence.officialResourceIsbn, '978-7-5720-4355-0');
  assert.equal(b.sourceEvidence.officialResourceIsbn, '978-7-5444-1656-6');
  for (const [book, count] of [[a, 113], [b, 98]]) {
    assert.equal(book.units.flatMap(u => u.words).length, book === a ? 122 : count);
    assert.equal(book.inventory.vocabularyCount, count); assert.equal(book.inventory.wordBankComplete, false);
    for (const u of book.units) {
      assert.match(u.vocabularyAudioEvidence.sha256, /^[a-f0-9]{64}$/);
      if (book === a) assert.ok(u.words.every(w => w.vocabularyPrintPage || w.topicCataloguePdfPage));
      else assert.ok(u.words.every(w => w.vocabularyAudioTrack === u.vocabularyAudioEvidence.track));
    }
    for (const item of learning.searchCatalog({ bookId: book.id })) {
      const m = item.gradeMappings.find(m => m.bookId === book.id);
      if (book === a) { assert.equal(m.sourceKind, 'official_textbook'); assert.ok(m.sourcePdfPage > 0); }
      else { assert.equal(m.sourceKind, 'official_audio'); assert.equal(m.sourcePrintPage, undefined); assert.equal(m.sourcePdfPage, undefined); }
      if (book === b) assert.equal(m.editionStatus, 'historical_reference');
    }
  }
  assert.equal(a.sourceEvidence.pendingVocabulary.length, 0);
  assert.ok(a.units[3].words.some(w => w.text === 'toe' && w.vocabularyPrintPage === 89));
  assert.equal(a.inventory.vocabularyListComplete, true);
  assert.equal(a.units[5].vocabularyAudioEvidence.contextTrack.track, '37 Unit 6 Fun time.mp3');
  assert.match(learning.catalogById.get('word-will').detail, /意志；决心/);
  assert.match(learning.catalogById.get('word-mouse').detail, /老鼠；鼠标/);
  assert.match(learning.catalogById.get('word-chicken').detail, /鸡；鸡肉/);
  for (const [id, senses] of [['word-chinese', ['汉语', '中国人', '中国的']], ['word-drink', ['喝', '饮料']],
    ['word-email', ['电子邮件', '发电子邮件']], ['word-glue', ['胶水', '粘贴']], ['word-will', ['意志', '将', '愿意']]]) {
    for (const sense of senses) assert.ok(learning.catalogById.get(id).detail.includes(sense), `${id}: ${sense}`);
  }
  assert.ok(learning.catalogById.get('word-tv').gradeMappings.some(m => m.bookId === a.id));
  assert.equal(learning.catalogById.has('sh54-word-television'), false);
  assert.equal(learning.catalog.filter(i => i.id === 'sh54-word-take-it-easy').length, 1);
});

test('39 grade-five groups expose original readable content with questions and retain partial curriculum status', () => {
  assert.equal(data.books.reduce((n, b) => n + b.units.length, 0), 39);
  for (const book of data.books) {
    assert.equal(book.schoolAdoption, 'pending'); assert.equal(book.inventory.fullCoverage, false);
    for (const u of book.units) {
      const items = learning.searchCatalog({ bookId: book.id, unitId: u.id });
      const reading = items.find(i => i.kind === (book.subject === 'chinese' ? 'reading' : 'english-reading') && i.studyArea !== 'literacy');
      for (const text of [u.practice.body, u.practice.question, u.practice.answer]) assert.ok(reading.detail.includes(text));
      assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
      if (book.subject === 'chinese') assert.ok(pinyinFor(reading));
      else assert.equal(items.filter(i => i.kind === 'sentence').length, 4);
    }
    assert.equal(learning.searchCatalog({ bookId: book.id, grade: 4 }).length, 0);
  }
  const p = learning.progress({ records: {} }).grades[4];
  assert.equal(p.total, 263); assert.equal(p.practice.total, 127); assert.equal(p.fullGradeComplete, false);
});

test('grade-five reading aids keep reviewed polyphonic character and sentence readings', () => {
  const sounds = (id, ch) => pinyinFor(learning.catalogById.get(id)).body.flat().filter(t => t.text === ch).map(t => t.pinyin);
  assert.ok(sounds('sh54-zh-5a-u2-literacy', '任').every(x => x === 'rén'));
  assert.ok(sounds('sh54-zh-5a-u2-literacy', '强').every(x => x === 'qiǎng'));
  assert.ok(sounds('sh54-zh-5a-u8-literacy', '识').every(x => x === 'zhì'));
  assert.ok(sounds('sh54-zh-5b-u2-literacy', '绰').every(x => x === 'chāo'));
  assert.ok(sounds('sh54-zh-5b-u4-literacy', '监').every(x => x === 'jiàn'));
  assert.ok(sounds('sh54-zh-5b-u5-literacy', '夫').every(x => x === 'fú'));
  assert.ok(sounds('sh54-zh-5b-u1-reading', '转').every(x => x === 'zhuàn'));
  assert.ok(sounds('sh54-zh-5a-u6-reading', '地').every(x => x === 'de'));
  assert.ok(sounds('sh54-zh-5a-u7-reading', '着').every(x => x === 'zhe'));
});

test('grade-five records sync between clients, remain filterable as learned and reuse old word history', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-5b-u7-literacy', 'sh54-en-5b-u4-reading', 'word-apple'];
  assert.ok(learning.catalogById.get('word-apple').gradeMappings.some(m => m.grade === 1));
  assert.ok(learning.catalogById.get('word-apple').gradeMappings.some(m => m.bookId === 'english-5b-legacy'));
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(24 * 60 * 60 * 1000);
  const a = f.client('parent-a'), b = f.client('parent-b');
  await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  assert.equal((await b.engine.getHistory({ childId })).total, 3);
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[4].learned, 2); assert.equal(progress.grades[4].practice.learned, 1);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId, i])),
    data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-5b-legacy' } } });
  page.changeUnit({ detail: { value: 4 } });
  assert.equal(page.data.items.find(i => i.id === ids[1]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } });
  assert.ok(!page.data.items.some(i => i.id === ids[1]));
});
