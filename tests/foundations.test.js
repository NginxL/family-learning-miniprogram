const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { books } = require('../scripts/lower-primary').data;
const chinese = require('../data/catalogs/chinese-foundation-system.json');
const english = require('../data/catalogs/english-foundation-system.json');
const reviewed = require('../data/catalogs/english-reviewed-meanings.json');
const recitations = require('../data/catalogs/chinese-recitation-requirements.json');
const { decorate } = require('../miniprogram/lib/page');
const { pinyinFor } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');
const foundation = learning.catalog.filter(item => item.learningArea);
const compact = text => text.replace(/\s/g, '');
const done = (id, date, ledger) => learning.recordTasks(ledger,
  [{ ...learning.taskFrom(learning.catalogById.get(id), 'child', `task-${id}`, 'manual'), done: true }], date);

test('reviewed generic word cards use school-level senses and preserve distinct inflections', () => {
  assert.equal(reviewed.entries.length, 96); assert.equal(new Set(reviewed.entries.map(e => e.id)).size, 96);
  assert.equal(learning.catalog.filter(i => i.kind === 'word').length, 2748);
  assert.ok(learning.catalog.filter(i => i.kind === 'word').every(i => !i.note?.includes('通用词典参考')));
  for (const entry of reviewed.entries) {
    const item = learning.catalogById.get(entry.id);
    assert.equal(item.kind, 'word'); assert.ok(item.detail.includes(entry.meaning));
    assert.ok(item.detail.includes(entry.example)); assert.ok(item.detail.includes(entry.translation));
    assert.match(item.source, /自编/); assert.equal(item.textSourceUrl, undefined);
  }
  const byWord = name => reviewed.entries.find(entry => entry.word === name);
  assert.match(byWord('ad').meaning, /广告/); assert.ok(!byWord('ad').meaning.includes('计算'));
  assert.match(byWord('found').meaning, /founded/); assert.match(byWord('lay').meaning, /laid/);
  assert.match(byWord('insect').meaning, /昆虫/); assert.match(byWord('quarter').meaning, /一刻钟/);
});

test('unmapped vocabulary remains ungraded while named five-four book mappings retain their semesters', () => {
  const unmapped = learning.catalog.filter(i => i.kind === 'word' && !i.gradeMappings?.length);
  assert.equal(unmapped.length, 404);
  for (const item of unmapped) {
    assert.match(learning.knowledgeGradeLabel(item), /教材年级、学期待核实/);
    for (let grade = 1; grade <= 9; grade++) assert.ok(!learning.searchCatalog({ grade }).some(i => i.id === item.id));
  }
  for (const item of foundation) for (const mapping of item.gradeMappings) {
    const book = books.find(b => b.id === mapping.bookId);
    assert.equal(mapping.grade, book.grade); assert.equal(mapping.semester, book.semester);
    const anchorId = chinese.lessons.find(lesson => lesson.id === item.id)?.anchorId;
    const expectedSource = anchorId ? learning.catalogById.get(anchorId).gradeMappings.find(m => m.bookId === book.id).sourceUrl : book.sourceUrl;
    assert.equal(mapping.sourceUrl, expectedSource); assert.equal(mapping.schoolSystem, '5-4');
    assert.equal(mapping.mappingType, 'aligned_practice');
    if (book.editionStatus === 'historical_reference') assert.match(learning.knowledgeGradeLabel(item), /旧版参考/);
  }
});

test('foundation cards contain usable original instruction and independent practice identities', () => {
  assert.equal(foundation.length, 125);
  const counts = Object.fromEntries(learning.learningAreas.map(area => [area.id, foundation.filter(i => i.learningArea === area.id).length]));
  assert.deepEqual(counts, { recitation: 9, classical: 51, vocabulary: 10, grammar: 55 });
  for (const lesson of [...chinese.lessons, ...english.lessons]) {
    const item = learning.catalogById.get(lesson.id);
    assert.ok(item.manualOnly); assert.equal(item.workId, undefined); assert.equal(item.coveredContentIds, undefined);
    assert.ok(item.detail.includes(lesson.explanation));
    assert.equal(lesson.exercises.length, 2);
    for (const exercise of lesson.exercises) {
      assert.ok(item.detail.includes(exercise.question)); assert.ok(item.detail.includes(exercise.answer));
    }
    if (lesson.anchorId) {
      const anchor = learning.catalogById.get(lesson.anchorId);
      assert.ok(compact(anchor.detail).includes(compact(lesson.quote)), lesson.id);
      assert.deepEqual(item.bookIds, [...new Set(anchor.gradeMappings.map(m => m.bookId))]);
    }
  }
});

test('recitation requirements retain precise source pages and do not expand a partial assignment to a whole work', () => {
  assert.equal(recitations.entries.length, 58);
  assert.equal(new Set(recitations.entries.map(entry => entry.contentId)).size, 56);
  assert.equal(new Set(recitations.entries.map(entry => `${entry.contentId}/${entry.bookId}`)).size, 58);
  for (const entry of recitations.entries) {
    const item = learning.catalogById.get(entry.contentId), mapping = item.gradeMappings.find(m => m.bookId === entry.bookId);
    assert.equal(entry.sourceUrl, mapping.sourceUrl);
    assert.equal(entry.sourcePdfPage - entry.sourcePrintPage, mapping.sourcePdfPage - mapping.sourcePrintPage);
    assert.ok(item.recitationRequirements.some(e => e.bookId === entry.bookId && e.requirement === entry.requirement));
  }
  const song = learning.catalogById.get('sh54-songdongyang-textbook');
  const range = song.recitationRequirements[0];
  assert.equal(range.requirement, '背诵前两段'); assert.equal(range.sourcePdfPage, 63); assert.equal(range.sourcePrintPage, 56);
  assert.equal(range.start, '余幼时即嗜学。'); assert.equal(range.end, '盖余之勤且艰若此。');
  assert.match(decorate(song).recitationNote, /旧版参考.*前两段/);
  assert.match(decorate(learning.catalogById.get('poem-goose')).recitationNote, /范围待核实/);
  assert.equal(decorate({ id: 'custom', kind: 'poetry', title: song.title, detail: '同名练习' }).recitationNote, undefined);
});

test('grammar source locations are catalogue evidence and understanding-only curriculum levels remain explicit', () => {
  // Independently read contents pages, not guessed chapter positions or six-three grades.
  const examples = {
    'skill-en-personal-pronouns': ['english-6a-2024', 'u2', 9],
    'skill-en-question-tags': ['english-6a-2024', 'u5', 10],
    'skill-en-present-perfect': ['english-7a-2024', 'u4', 8],
    'skill-en-past-continuous': ['english-7b-2024', 'u5', 8],
    'skill-en-time-clauses': ['english-8a-2024', 'u1', 6],
    'skill-en-exclamations': ['english-8b-2024', 'u2', 6],
    'skill-en-relative-clauses': ['english-9a-2024', 'u2', 6],
    'skill-en-passive-future': ['english-9a-2024', 'u6', 8]
  };
  for (const [id, expected] of Object.entries(examples)) {
    const mapping = learning.catalogById.get(id).gradeMappings[0];
    assert.deepEqual([mapping.bookId, mapping.unitId, mapping.sourcePdfPage], expected);
    assert.equal(mapping.sourcePrintPage, undefined); assert.match(mapping.evidence, /目录证据页，不是语法正文页/);
  }
  for (const id of ['relative-clauses', 'nonfinite', 'subject-agreement', 'interjections', 'abbreviations']) {
    const lesson = english.lessons.find(l => l.id === `skill-en-${id}`);
    assert.equal(lesson.level, 'understanding'); assert.match(learning.catalogById.get(lesson.id).note, /辨认或理解/);
  }
  const unmapped = learning.catalogById.get('skill-en-word-family');
  assert.deepEqual(unmapped.gradeMappings, []); assert.match(learning.knowledgeGradeLabel(unmapped), /待核实/);
});

test('new foundation cards cannot change the material pool or fill automatic reading quotas', () => {
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map(rule => ({ ...rule, scope: 'all', quantity: 3 })) } };
  for (const scope of ['starter', 'foundation', 'moe-all', 'tables', 'shanghai54', 'shanghai-exam', 'all'])
    assert.ok(learning.materialPool(family, 'child', scope).every(item => !learning.catalogById.get(item.id)?.manualOnly));
  // Exhaust all old content; only the new cards remain unseen, and must not be substituted.
  const ledger = { records: {} };
  for (const item of learning.catalog.filter(i => !i.learningArea)) done(item.id, '2026-10-12', ledger);
  const day = learning.generateDay(family, { date: '2026-10-13', tasks: [] }, { child: ledger });
  assert.equal(day.tasks.length, 0);
});

test('learning an original work and completing its knowledge practice never grant each other credit', () => {
  const original = 'moe-2022-zh-7-9-049', practice = `skill-zh-${original}`;
  for (const [id, other] of [[original, practice], [practice, original]]) {
    const ledger = { records: {} }; done(id, '2026-10-12', ledger);
    assert.equal(learning.wasLearned(ledger, learning.catalogById.get(other)), false);
    assert.ok(!learning.learningStatus(ledger).items.some(item => item.contentId === other));
  }
  const ledger = { records: {} }; done(practice, '2026-10-12', ledger);
  const grade = learning.progress(ledger).grades[7];
  assert.equal(grade.learned, 0); assert.equal(grade.practice.learned, 1); assert.equal(grade.fullGradeComplete, false);
});

test('corrected word content does not rewrite stored completed days, mastery or prior dates', () => {
  const current = learning.catalogById.get(reviewed.entries[0].id);
  const old = { ...learning.taskFrom(current, 'child', 'old-word', 'new'), detail: '此前学习时保存的词典参考', done: true };
  const ledger = { records: {} }; learning.recordTasks(ledger, [old], '2026-10-12');
  ledger.records[current.id].mastered = true;
  const before = structuredClone({ old, ledger });
  const day = { date: '2026-10-12', tasks: [old] };
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules() } };
  learning.generateDay(family, day, { child: ledger }, true);
  assert.deepEqual(day.tasks, [before.old]); assert.deepEqual(ledger, before.ledger);
  assert.equal(learning.learningStatus(ledger).items[0].mastered, true);
});

test('first and second grade new recitation exercises retain correct static pinyin', () => {
  const items = foundation.filter(item => item.gradeMappings.some(m => m.grade <= 2));
  assert.equal(items.length, 2);
  for (const item of items) assert.ok(pinyinFor(item), item.id);
  const poem = pinyinFor(items.find(item => item.title.includes('黄鹂'))).body.flat();
  assert.ok(poem.filter(token => token.text === '行').every(token => token.pinyin === 'háng'));
  assert.ok(poem.filter(token => token.text === '核').every(token => token.pinyin === 'hé'));
});

test('manual foundation work syncs across parents after a lost response and library filters retain learned status', async t => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId: family.id, childId }, date = '2026-10-13';
  await f.call('parent-a', 'saveAutoPlans', { ...base, rules: learning.emptyRules() });
  const ids = ['skill-en-present-perfect', 'skill-zh-moe-2022-zh-7-9-049', reviewed.entries[0].id];
  for (const contentId of ids) await f.call('parent-a', 'assignContent', { ...base, contentId, date });
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) a.engine.enqueue(date, task.id, true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(task => task.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.deepEqual(new Set(status.items.map(i => i.contentId)), new Set(ids));
  assert.ok(status.items.every(i => i.learnedCount === 1));
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  const page = { ...definition, learningIndex: new Map(status.items.map(i => [i.contentId, i])), data: { ...structuredClone(definition.data), learningReady: true }, setData(patch) { Object.assign(this.data, patch); } };
  page.showExamContent({ currentTarget: { dataset: { kind: 'english-reading', area: 'grammar' } } });
  assert.equal(page.data.total, 55); assert.ok(page.data.items.every(i => i.learningArea === 'grammar'));
  assert.equal(page.data.items.find(i => i.id === ids[0]).learnedLabel, '已学过');
  page.changeLearningFilter({ detail: { value: 1 } }); assert.equal(page.data.total, 54);
  page.changeLearningFilter({ detail: { value: 0 } });
  page.changeLearningArea({ detail: { value: page.data.learningAreas.findIndex(i => i.id === 'classical') } });
  assert.equal(page.data.total, 51);
  page.showBook({ currentTarget: { dataset: { id: 'english-9a-2024' } } });
  assert.equal(page.data.learningAreaIndex, 0); assert.ok(page.data.items.some(i => i.kind === 'word'));
  assert.equal(page.data.readingCount, 230); assert.equal(page.data.englishReadingCount, 161); assert.equal(page.data.foundationCount, 125);
});

test('framework coverage numbers come from the same catalogue used by pages and never claim complete exam coverage', () => {
  assert.deepEqual(resources.examFramework.counts, { poetry: 260, word: 2748, sentence: 690, reading: 230,
    englishReading: 161, recitation: 9, classical: 51, vocabulary: 10, grammar: 55, recitationRequirements: 58, unmappedWords: 404 });
  assert.equal(resources.examFramework.complete, false); assert.equal(resources.examFramework.coverageRate, null);
  assert.equal(resources.curriculum.slots.filter(slot => slot.editionReview).length, 7);
  assert.ok(resources.curriculum.slots.every(slot => slot.fullCoverage === false));
});
