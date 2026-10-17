const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const data = require('../data/catalogs/shanghai-54-lower-primary.json');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');

test('verified lower-primary inventories retain all unit positions and keep pending books out of grade filters', () => {
  const expected = { 'chinese-1a-sample': [280, 284, 100], 'chinese-1b-sample': [410, 419, 200], 'chinese-2a-sample': [460, 480, 250], 'chinese-2b-sample': [450, 465, 250] };
  for (const book of data.books) {
    assert.equal(book.inventory.fullCoverage, false); assert.equal(book.schoolAdoption, 'pending');
    const items = learning.searchCatalog({ bookId: book.id });
    assert.ok(items.length > book.units.length);
    for (const unit of book.units) {
      const unitItems = learning.searchCatalog({ bookId: book.id, unitId: unit.id });
      assert.ok(unitItems.some(item => item.gradeMappings.some(mapping => mapping.mappingType === 'aligned_practice')));
      assert.ok(unitItems.every(item => item.gradeMappings.some(mapping => mapping.bookId === book.id && mapping.unitId === unit.id
        && mapping.grade === book.grade && mapping.semester === book.semester)));
      if (book.subject === 'english') {
        assert.equal(unitItems.filter(item => item.kind === 'sentence').length, 3);
        assert.equal(unitItems.filter(item => item.kind === 'english-reading').length, 1);
        for (const word of unit.words) assert.equal(unitItems.filter(item => item.kind === 'word' && (item.aliases || []).includes(word.text)).length, 1, word.text);
      }
    }
    if (book.subject === 'chinese' && book.inventory.recognitionComplete) {
      const [recognized, positions, written] = expected[book.id];
      assert.equal(book.inventory.recognitionCount, recognized);
      assert.equal(book.units.reduce((n, unit) => n + unit.recognition.join('').length, 0), positions);
      const allWritten = book.units.flatMap(unit => unit.writing).join('');
      assert.equal(allWritten.length, written); assert.equal(new Set(allWritten).size, written);
      assert.equal(book.inventory.writingCount, written);
      assert.ok(items.every(item => pinyinFor(item)), book.id);
    }
    assert.equal(learning.searchCatalog({ bookId: book.id, semester: book.semester === '上册' ? '下册' : '上册' }).length, 0);
  }
  assert.equal(learning.searchCatalog({ grade: 2, semester: '下册' }).length, 111);
  assert.equal(learning.searchCatalog({ grade: 2, subject: 'english' }).length, 168);
});

test('unit character readings preserve textbook polyphones and original reading aids use context', () => {
  const sounds = (id, character) => pinyinFor(learning.catalogById.get(id)).body.flat().filter(token => token.text === character).map(token => token.pinyin);
  assert.ok(sounds('sh54-zh-1a-u3-literacy', '数').includes('shù'));
  assert.ok(sounds('sh54-zh-1a-u8-literacy', '数').includes('shǔ'));
  assert.ok(sounds('sh54-zh-1a-u5-literacy', '地').includes('de'));
  assert.ok(sounds('sh54-zh-1b-u6-literacy', '空').includes('kòng'));
  assert.ok(sounds('sh54-zh-1b-u7-literacy', '结').includes('jiē'));
  assert.ok(sounds('sh54-zh-1b-u8-literacy', '哪').includes('na'));
  assert.deepEqual(sounds('sh54-zh-1a-u8-reading', '长'), ['cháng', 'cháng']);
  assert.deepEqual(sounds('sh54-zh-1b-u4-reading', '着'), ['zháo']);
  assert.deepEqual(sounds('sh54-zh-1b-u8-reading', '落'), ['luò']);
  assert.deepEqual(sounds('sh54-zh-1b-u7-reading', '落'), ['là']);
  assert.deepEqual(sounds('sh54-zh-2a-u2-reading', '长'), ['cháng', 'cháng']);
  assert.ok(sounds('sh54-zh-2a-u5-reading', '干').every(value => value === 'gān'));
  assert.ok(sounds('sh54-zh-2a-u8-reading', '得').every(value => value === 'de'));
  for (const [unit, character, sound] of [[2, '的', 'dí'], [2, '蔗', 'zhè'], [3, '炸', 'zhá'], [4, '倒', 'dǎo'], [5, '圈', 'juàn'],
    [6, '泊', 'bó'], [7, '喝', 'hè'], [7, '尽', 'jǐn'], [7, '扫', 'sào'], [8, '待', 'dāi'], [8, '难', 'nàn']]) {
    assert.ok(sounds(`sh54-zh-2b-u${unit}-literacy`, character).includes(sound), `${character}/${sound}`);
  }
  assert.deepEqual(sounds('sh54-zh-2b-u7-literacy', '扇'), ['shān', 'shàn']);
  assert.deepEqual(sounds('sh54-zh-2b-u5-reading', '倒'), ['dǎo']);
  assert.deepEqual(sounds('sh54-zh-2b-u5-reading', '重'), ['chóng']);
  assert.ok(sounds('sh54-zh-2b-u5-reading', '着').every(value => value === 'zhe'));
  assert.ok(sounds('moe-2022-zh-1-6-075', '长').includes('zhǎng'));
  const phonics = pinyinFor(learning.catalogById.get('sh54-zh-1a-u2-reading')).body.flat();
  assert.ok(phonics.some(token => token.text === 'mǎ' && token.pinyin === ''));
  assert.ok(phonics.some(token => token.text === 'bà' && token.after === '；'));
});

test('Chinese 2B distinguishes 450 new characters from 15 review positions and uses its own page offset', () => {
  const book = data.books.find(book => book.id === 'chinese-2b-sample');
  const newCharacters = [];
  for (const unit of book.units) {
    const characters = [...unit.recognition.join('')];
    for (const reviewed of unit.recognitionReviewCharacters) {
      assert.ok(characters.includes(reviewed)); characters.splice(characters.indexOf(reviewed), 1);
    }
    newCharacters.push(...characters);
    const item = learning.catalogById.get(`sh54-zh-2b-${unit.id}-literacy`);
    const evidence = item.gradeMappings.find(mapping => mapping.bookId === book.id);
    assert.equal(evidence.sourcePrintPage, unit.recognitionPrintPages[0]);
    assert.equal(evidence.sourcePdfPage, evidence.sourcePrintPage + 6);
    assert.equal(item.gradeMappings[0].sourceUrl, book.sourceUrl);
  }
  assert.equal(newCharacters.length, 450); assert.equal(new Set(newCharacters).size, 450);
  assert.equal(book.units.flatMap(unit => unit.recognitionReviewCharacters).length, 15);
  assert.equal(book.units[0].recognition[0], '咏贺妆丝裁剪莺拂堤醉趁');
  assert.equal(book.units[7].writing.at(-1), '灿烂');
});

test('Word bank additions keep old learning identities and distinguish printed sample from official audio evidence', () => {
  const b = data.books.find(book => book.id === 'english-2b-sample');
  assert.deepEqual(b.units.map(unit => unit.wordBankEntries.length), [4, 4, 4, 3, 3, 4, 4, 8, 5, 4]);
  const items = learning.searchCatalog({ bookId: b.id });
  for (const id of ['word-fish', 'word-share', 'sh54-word-after-using-the-toilet']) {
    const mapping = items.find(item => item.id === id).gradeMappings.find(mapping => mapping.bookId === b.id);
    assert.equal(mapping.sourceKind, 'official_audio');
    assert.equal(mapping.sourcePrintPage, undefined); // No invented paper page from an audio track.
    assert.match(mapping.evidence, /57204137/);
  }
  for (const id of ['sh54-word-talk-and-share', 'sh54-word-after-going-to-the-toilet']) {
    assert.ok(items.some(item => item.id === id));
    assert.equal(items.find(item => item.id === id).gradeMappings.find(mapping => mapping.bookId === b.id).sourceKind, 'public_sample');
  }
  assert.match(learning.catalogById.get('sh54-word-after-using-the-toilet').source, /Word bank 音频/);
  const a = data.books.find(book => book.id === 'english-2a-sample');
  assert.equal(a.units.flatMap(unit => unit.officialWordBankAudioEntries).length, 42);
  const dressed = learning.catalogById.get('sh54-word-get-dressed').gradeMappings.find(mapping => mapping.bookId === a.id);
  assert.equal(dressed.sourcePrintPage, 65); assert.equal(dressed.sourcePdfPage, 69);
  assert.match(dressed.evidence, /未朗读/);
  const oldWords = ['word-fish', 'word-share', 'sh54-word-talk-and-share', 'sh54-word-after-going-to-the-toilet'];
  const ledger = { records: {} };
  learning.recordTasks(ledger, oldWords.map(id => ({ ...learning.taskFrom(learning.catalogById.get(id), 'child', 'old', 'new'), done: true })), '2026-10-12');
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(rule => ({ ...rule, quantity: rule.kind === 'word' ? 60 : 0, scope: 'shanghai54' })) } };
  const next = learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: ledger });
  assert.ok(next.tasks.every(task => !oldWords.includes(task.contentId)));
});

test('textbook word variants reuse canonical learning IDs; new practice does not duplicate old history', () => {
  const mother = learning.catalogById.get('word-mother');
  const father = learning.catalogById.get('word-father');
  assert.ok(mother.aliases.includes('mum')); assert.ok(father.aliases.includes('dad'));
  assert.ok(!learning.catalogById.has('sh54-word-mum')); assert.ok(!learning.catalogById.has('sh54-word-dad'));
  const learned = { records: {} };
  learning.recordTasks(learned, [{ ...learning.taskFrom(mother, 'child', 'old', 'new'), done: true }], '2026-10-12');
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(rule => ({ ...rule, quantity: rule.kind === 'word' ? 60 : 0, scope: 'shanghai54' })) } };
  const day = learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: learned });
  assert.ok(day.tasks.every(task => task.contentId !== mother.id));
  assert.equal(new Set(day.tasks.map(task => task.contentId)).size, day.tasks.length);
});

test('original unit practice is counted separately from verified textbook progress', () => {
  const ledger = { records: {} };
  const item = learning.catalogById.get('sh54-zh-2a-u2-reading');
  learning.recordTasks(ledger, [{ ...learning.taskFrom(item, 'child', 'practice', 'new'), done: true }], '2026-10-16');
  const progress = learning.progress(ledger);
  assert.equal(progress.grades[1].learned, 0);
  assert.equal(progress.grades[1].practice.learned, 1);
  assert.equal(progress.grades[1].practice.total, 97);
  assert.equal(progress.grades[1].total, 120);
  assert.equal(progress.highestGradeStarted, 0);
  assert.equal(progress.unclassifiedLearned, 0);
});

test('lower-primary content assigns, completes, syncs and reviews with the unchanged cloud API', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id;
  const base = { familyId: family.id, childId };
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['sh54-zh-2a-u2-literacy', 'sh54-en-1b-u8-reading', 'sh54-word-traffic-light'];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date: '2026-10-13' });
  f.advance(24 * 60 * 60 * 1000);
  const a = f.client('parent-a'), b = f.client('parent-b');
  await a.engine.sync('2026-10-13'); await b.engine.sync('2026-10-13');
  const task = a.engine.viewDay('2026-10-13').tasks.find(task => task.contentId === ids[0]);
  a.engine.enqueue('2026-10-13', task.id, true); await a.engine.sync('2026-10-13'); await b.engine.sync('2026-10-13');
  assert.equal(b.engine.viewDay('2026-10-13').tasks.find(item => item.id === task.id).done, true);
  const history = await b.engine.getHistory({ childId });
  assert.equal(history.total, 1); assert.equal(history.items[0].id, ids[0]);
  assert.match(history.items[0].detail, /榕 壮 梧 桐/);
  const progress = await f.call('parent-b', 'getProgress', base);
  assert.equal(progress.grades[1].learned, 1); assert.equal(progress.grades[1].fullGradeComplete, false);
  const duplicate = await f.call('parent-a', 'assignContent', { ...base, contentId: ids[1], date: '2026-10-13' });
  assert.equal(duplicate.task.contentId, ids[1]);
  assert.equal((await f.call('parent-a', 'getDay', { ...base, date: '2026-10-13' })).day.tasks.length, 3);
});

test('book navigation includes vocabulary, sentences and reading and never leaks a previous unit filter', t => {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.showBook({ currentTarget: { dataset: { id: 'english-1b-sample' } } });
  assert.equal(page.data.kindIndex, 0); assert.equal(page.data.subjectFilter, 'all'); assert.equal(page.data.bookUnits.length, 11);
  page.changeUnit({ detail: { value: 8 } });
  assert.deepEqual(new Set(page.data.items.map(item => item.kind)), new Set(['word', 'sentence', 'english-reading']));
  assert.ok(page.data.items.every(item => item.gradeMappings.some(mapping => mapping.bookId === 'english-1b-sample' && mapping.unitId === 'u8')));
  page.changeGrade({ detail: { value: 2 } });
  assert.equal(page.data.bookId, ''); assert.equal(page.data.unitIndex, 0); assert.equal(page.data.total, 217);
  page.changeSemester({ detail: { value: 2 } }); assert.equal(page.data.total, 111);
  page.showBook({ currentTarget: { dataset: { id: 'chinese-1b-sample' } } });
  assert.equal(page.data.semesterIndex, 0); assert.ok(page.data.items.some(item => item.kind === 'poetry')); assert.ok(page.data.items.some(item => item.studyArea === 'literacy'));
});

test('grade two samples retain different edition evidence, exact unit starts and optional units without inventing unseen tables', () => {
  const zh = data.books.find(book => book.id === 'chinese-2b-sample');
  const a = data.books.find(book => book.id === 'english-2a-sample');
  const b = data.books.find(book => book.id === 'english-2b-sample');
  assert.equal(zh.sourceKind, 'official_textbook');
  assert.equal(zh.inventory.recognitionComplete, true); assert.equal(zh.inventory.writingComplete, true);
  assert.deepEqual(zh.sourceEvidence.recognitionPrintPages, [113, 114, 115, 116]);
  assert.deepEqual(zh.sourceEvidence.writingPrintPages, [117, 118, 119]);
  assert.deepEqual(zh.units.map(unit => unit.sourcePrintPage), [1, 15, 29, 42, 55, 69, 84, 100]);
  assert.ok(zh.units[1].lessons.includes('我不是最弱小的'));
  assert.ok(zh.units[7].lessons.includes('黄帝的传说'));
  assert.deepEqual(a.units.map(unit => unit.sourcePrintPage), [5, 11, 17, 23, 29, 35, 41, 47, 53, 59]);
  assert.deepEqual(b.units.map(unit => unit.sourcePrintPage), [1, 7, 13, 19, 25, 31, 37, 43, 49, 55]);
  assert.equal(a.units.reduce((n, unit) => n + unit.words.length, 0), 43);
  assert.equal(b.units.reduce((n, unit) => n + unit.words.length, 0), 45);
  assert.deepEqual(b.units.filter(unit => unit.optional).map(unit => unit.number), [9, 10]);
  assert.ok(learning.searchCatalog({ bookId: b.id, unitId: 'u9' }).every(item => item.gradeMappings.some(mapping => mapping.bookId === b.id && mapping.unit.endsWith('（拓展）'))));
  for (const book of [a,b]) {
    assert.equal(book.inventory.wordBankComplete, true);
    assert.equal(book.units.flatMap(unit => unit.wordBankEntries).length, 43);
  }
  assert.equal(a.inventory.wordBankBasis, 'public_sample_pages');
  assert.equal(b.inventory.wordBankBasis, 'official_audio_crosschecked_catalogue');
  assert.equal(b.sourceEvidence.wordBankPrintedPagesVerified, false);
  assert.equal(pinyinFor(learning.catalogById.get('sh54-zh-2b-u5-reading')).title.flat().find(token => token.text === '倒').pinyin, 'dǎo');
});
