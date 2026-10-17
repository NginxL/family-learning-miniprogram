const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/catalogs/shanghai-54-grade4.json');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('grade-four Chinese keeps the 2024/2019 editions distinct and verifies exact new-character, review and writing inventories', () => {
  const [a, b] = data.books;
  assert.match(a.edition, /2024/); assert.match(b.edition, /2019/);
  assert.equal(b.editionStatus, 'historical_reference');
  for (const [book, reviews, writtenCount, rpages, wpages] of [
    [a, 15, 250, [122, 123, 124], [125, 126]], [b, 19, 280, [137, 138, 139], [140, 141]]
  ]) {
    const newCharacters = [];
    for (const unit of book.units) {
      const chars = [...unit.recognition.join('')];
      for (const ch of unit.recognitionReviewCharacters) {
        assert.ok(chars.includes(ch)); chars.splice(chars.indexOf(ch), 1);
      }
      newCharacters.push(...chars);
      for (const type of ['recognition', 'writing']) {
        assert.deepEqual(unit[type + 'PdfPages'], unit[type + 'PrintPages'].map(page => page + 6));
        for (const [i, row] of unit[type].entries()) assert.equal([...row].length, unit[type + 'Reading'][i].split(' ').length);
      }
    }
    assert.equal(newCharacters.length, 250); assert.equal(new Set(newCharacters).size, 250);
    assert.equal(book.units.flatMap(unit => unit.recognitionReviewCharacters).length, reviews);
    const written = book.units.flatMap(unit => unit.writing).join('');
    assert.equal(written.length, writtenCount); assert.equal(new Set(written).size, writtenCount);
    assert.equal(book.inventory.writingCount, writtenCount);
    assert.deepEqual(book.sourceEvidence.recognitionPrintPages, rpages);
    assert.deepEqual(book.sourceEvidence.writingPrintPages, wpages);
    assert.ok(Object.values(book.sourceEvidence.images).every(image => image.url.startsWith(book.sourceUrl) && /^[a-f0-9]{64}$/.test(image.sha256)));
  }
  assert.deepEqual(a.units.map(unit => unit.sourcePrintPage), [1, 13, 33, 47, 61, 73, 87, 107]);
  assert.deepEqual(b.units.map(unit => unit.sourcePrintPage), [1, 15, 35, 47, 63, 75, 101, 121]);
  assert.equal(a.units[0].recognition[0], '盐薄隆鼎沸浩崩霎余漫吼');
  assert.match(b.units[7].writing.at(-1), /搂颊拆$/);
  assert.ok(b.units[1].writing.some(row => row.includes('捷避敌')), '避 and 辟 are distinct source characters');
  assert.match(resources.curriculum.slots.find(slot => slot.contentBookId === b.id).contentNote, /历史审定样本/);
});

test('twenty-three grade-four ancient works have observed author/opening-line identities and avoid duplicate national works', () => {
  assert.equal(data.poems.length, 11);
  for (const book of data.books.slice(0, 2)) {
    const poems = book.units.flatMap(unit => unit.poems || []);
    assert.equal(poems.length, book.semester === '上册' ? 12 : 11);
    for (const p of poems) {
      const item = learning.catalogById.get(p.contentId);
      assert.ok(item.detail.includes(p.identityEvidence.firstLine));
      assert.equal(item.author, p.identityEvidence.author);
      assert.equal(item.gradeMappings.filter(m => m.bookId === book.id).length, 1);
      assert.equal(p.sourcePdfPage, p.sourcePrintPage + (p.sourceKind === 'official_textbook' ? 5 : 6));
      if (p.sourceKind === 'official_textbook') assert.match(p.sourceUrl, /basic.smartedu.cn/);
      else assert.ok(book.sourceEvidence.images[`zh4${book.semester === '上册' ? 'a' : 'b'}-${p.sourcePdfPage}.jpg`]);
    }
  }
  const poems = learning.searchCatalog({ grade: 4, kind: 'poetry' });
  assert.equal(poems.length, 23);
  assert.ok(poems.some(p => p.id === 'moe-2022-zh-1-6-011'));
  assert.ok(!poems.some(p => p.id === 'moe-2022-zh-1-6-008'), 'Wang Han Liangzhouci is not Wang Zhihuan Liangzhouci');
  assert.match(learning.catalogById.get('sh54-xinshi').detail, /树头新绿未成阴/);
  assert.equal(learning.catalogById.get('sh54-nangying').dynasty, '唐代');
  assert.match(learning.catalogById.get('sh54-nangying').dynastyNote, /编纂/);
  assert.equal(learning.catalogById.get('sh54-jingwei').dynasty, '成书年代待考');
});

test('English grade-four unit words distinguish verified printed upper-semester words from historical lower-semester audio', () => {
  const [, , a, b] = data.books;
  assert.equal(a.sourceEvidence.officialResourceIsbn, '978-7-5720-4356-7');
  assert.equal(b.sourceEvidence.officialResourceIsbn, '978-7-5444-1653-5');
  assert.equal(a.units.length, 10); assert.equal(b.units.length, 12);
  assert.equal(a.units[3].title, 'Our birthday'); assert.equal(b.units[7].title, 'Time');
  assert.equal(b.units[3].displayLabel, 'Module 2 / Unit 1 · Sports');
  for (const [book, count] of [[a, 141], [b, 61]]) {
    assert.equal(book.units.flatMap(unit => unit.words).length, book === a ? 146 : count);
    assert.equal(book.inventory.vocabularyCount, count);
    assert.equal(book.inventory.wordBankComplete, false);
    for (const item of learning.searchCatalog({ bookId: book.id })) {
      const m = item.gradeMappings.find(m => m.bookId === book.id);
      if (book === a) { assert.equal(m.sourceKind, 'official_textbook'); assert.ok(m.sourcePdfPage > 0); }
      else { assert.equal(m.sourceKind, 'official_audio'); assert.equal(m.sourcePrintPage, undefined); assert.equal(m.sourcePdfPage, undefined); assert.match(m.outlineDestination, /\.mp3$/); }
      if (book === b) { assert.equal(m.editionStatus, 'historical_reference'); assert.match(m.evidence, /旧版参考/); }
    }
  }
  assert.equal(a.units[6].words.find(word => word.text === 'week').meaning, '星期；周');
  assert.ok(!a.units[6].words.some(word => word.text === 'weak'));
  assert.equal(a.units[6].vocabularyAudioEvidence.contextTrack.track, '44 Unit 7 Talking time.mp3');
  const hard = learning.catalogById.get('word-hard');
  assert.equal(hard.detail, 'hard\n努力地；硬的');
  assert.match(hard.gradeMappings.find(m => m.bookId === b.id).evidence, /本单元用义：硬的/);
  const triangle = learning.catalogById.get('sh54-word-triangle');
  assert.match(triangle.detail, /三角形；三角铁/);
  assert.match(triangle.gradeMappings.find(m => m.bookId === b.id).evidence, /本单元用义：三角铁/);
  const tv = learning.catalogById.get('word-tv');
  assert.ok(tv.aliases.includes('TV') && tv.aliases.includes('television'));
  assert.equal(tv.gradeMappings.filter(m => m.bookId === b.id && m.unitId === 'u7').length, 1);
  assert.equal(learning.catalogById.has('sh54-word-television'), false);
});

test('all 38 grade-four units expose readable content, aligned sentences, questions and source boundaries', () => {
  assert.equal(data.books.reduce((n, b) => n + b.units.length, 0), 38);
  for (const book of data.books) {
    assert.equal(book.grade, 4); assert.equal(book.schoolSystem, '5-4');
    assert.equal(book.schoolAdoption, 'pending'); assert.equal(book.inventory.fullCoverage, false);
    for (const unit of book.units) {
      const items = learning.searchCatalog({ bookId: book.id, unitId: unit.id });
      const reading = items.find(item => item.kind === (book.subject === 'chinese' ? 'reading' : 'english-reading') && item.studyArea !== 'literacy');
      assert.ok(reading.detail.includes(unit.practice.body));
      assert.ok(reading.detail.includes(unit.practice.question)); assert.ok(reading.detail.includes(unit.practice.answer));
      assert.equal(reading.gradeMappings[0].mappingType, 'aligned_practice');
      if (book.subject === 'chinese') assert.ok(pinyinFor(reading));
      else {
        assert.equal(items.filter(item => item.kind === 'sentence').length, 4);
        assert.equal(unit.practice.translation.length, 4);
      }
    }
    assert.equal(learning.searchCatalog({ bookId: book.id, grade: 3 }).length, 0);
  }
  assert.equal(learning.progress({ records: {} }).grades[3].total, 241);
  assert.equal(learning.progress({ records: {} }).grades[3].practice.total, 126);
});

test('grade-four reading aids preserve contextual polyphonic readings and new/review character pronunciations', () => {
  const sounds = (id, char) => pinyinFor(learning.catalogById.get(id)).body.flat().filter(t => t.text === char).map(t => t.pinyin);
  assert.ok(sounds('sh54-zh-4a-u3-literacy', '降').every(p => p === 'xiáng'));
  assert.ok(sounds('sh54-zh-4b-u4-literacy', '屏').every(p => p === 'bǐng'));
  assert.ok(sounds('sh54-zh-4b-u7-literacy', '单').every(p => p === 'chán'));
  assert.ok(sounds('sh54-zh-4a-u8-reading', '还').every(p => p === 'huán'));
  assert.ok(sounds('sh54-zh-4a-u8-reading', '行').every(p => p === 'xíng'));
  assert.deepEqual(sounds('sh54-zh-4b-u3-reading', '行'), ['háng']);
  assert.deepEqual(sounds('sh54-zh-4b-u5-reading', '长'), ['cháng']);
  assert.ok(sounds('sh54-zh-4b-u7-reading', '了').includes('liǎo'));
  assert.ok(sounds('sh54-zh-4b-u7-reading', '得').every(p => p === 'de'));
});

test('grade-four learning syncs between clients, displays learned badges and preserves earlier shared-word history', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-4b-u7-literacy', 'sh54-en-4b-u4-reading', 'word-apple'];
  assert.ok(learning.catalogById.get('word-apple').gradeMappings.some(m => m.grade === 1));
  assert.ok(learning.catalogById.get('word-apple').gradeMappings.some(m => m.bookId === 'english-4a-2026'));
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(24 * 60 * 60 * 1000);
  const a = f.client('parent-a'), b = f.client('parent-b');
  await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(item => item.contentId)), new Set(ids));
  assert.equal((await b.engine.getHistory({ childId })).total, 3);
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[3].learned, 2); assert.equal(progress.grades[3].practice.learned, 1);
  assert.equal(progress.grades[3].fullGradeComplete, false);
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(item => [item.contentId, item])),
    data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-4b-legacy' } } });
  page.changeUnit({ detail: { value: 4 } });
  const card = page.data.items.find(item => item.id === ids[1]);
  assert.equal(card.learnedLabel, '已学过'); assert.match(card.gradeLabel, /旧版参考/);
  page.changeLearningFilter({ detail: { value: 1 } });
  assert.ok(!page.data.items.some(item => item.id === ids[1]));
});
