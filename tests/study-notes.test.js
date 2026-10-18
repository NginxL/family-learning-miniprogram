const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const learning = require('../shared/learning');
const knowledge = require('../shared/knowledge-data.json');
const classical = require('../data/catalogs/chinese-classical-details.json');
const english = require('../data/catalogs/english-word-study.json');
const recitations = require('../data/catalogs/chinese-recitation-requirements.json');
const { decorate } = require('../miniprogram/lib/page');
const { fixture } = require('./helpers');
const { beforeChineseCorrections } = require('./chinese-baseline-helper');
const compact = value => value.replace(/[\s，。；、！？：“”‘’]/g, '');
const event = id => ({ currentTarget: { dataset: { id } } });

test('supplemental guides preserve identities, placement and automatic pools with only reviewed Chinese corrections', () => {
  // Independent baseline at c6c4f8f; approved Chinese field changes are checked separately.
  const original = knowledge.map(({ studyNotes, recitationRequirements, ...item }) => beforeChineseCorrections(item));
  assert.equal(original.length, 4190);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    '3774d9f395e3374a0b4784ef392b86d79c46129764356fb561279e17b0a023c4');
  assert.equal(learning.catalog.length, 4234);
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules() } };
  for (const scope of ['starter', 'foundation', 'moe-all', 'tables', 'shanghai54', 'all']) {
    const pool = learning.materialPool(family, 'child', scope);
    assert.deepEqual(pool.map(i => i.id), learning.catalog.filter(i => !i.manualOnly && learning.inScope(i, scope)).map(i => i.id));
  }
});

test('each classical guide is anchored to its own text and does not invent missing textbook placement', () => {
  assert.equal(classical.entries.length, 55);
  assert.equal(new Set(classical.entries.map(e => e.contentId)).size, 55);
  for (const entry of classical.entries) {
    const item = learning.catalogById.get(entry.contentId), notes = item.studyNotes;
    assert.equal(item.kind, 'poetry'); assert.ok(entry.words.length >= 5);
    for (const sentence of entry.sentences) assert.ok(compact(item.detail).includes(compact(sentence.text)), entry.contentId);
    assert.deepEqual(notes.exercises, entry.exercises);
    assert.ok(notes.sources.every(source => source.url.startsWith('https://')));
    assert.ok(notes.notice.includes('自编')); assert.ok(notes.notice.includes('不是教材注释'));
  }
  const boya = learning.catalogById.get('moe-2022-zh-7-9-046');
  assert.ok(!boya.gradeMappings?.length); assert.match(learning.knowledgeGradeLabel(boya), /待核/);
  const sanxia = classical.entries.find(e => e.contentId === 'moe-2022-zh-7-9-051');
  assert.ok(!JSON.stringify(sanxia).includes('游鱼'));
});

test('back-recitation evidence retains book-specific ranges and does not transfer assignments to a neighbouring text or edition', () => {
  const get = id => learning.catalogById.get(id);
  assert.match(get('sh54-nangying').recitationRequirements[0].requirement, /全文/);
  assert.ok(!get('sh54-tiechu').recitationRequirements?.length);
  assert.match(decorate(get('sh54-tiechu')).recitationNote, /范围待核实/);
  const title = 'moe-2022-zh-7-9-036';
  assert.match(decorate(get(title)).recitationNote, /旧版参考/);
  assert.match(decorate(get(title)).recitationNote, /9年级上册：熟读成诵/);
  const base = new Set(recitations.entries.slice(0, 58).map(e => `${e.contentId}/${e.bookId}`));
  assert.equal(recitations.entries.filter(e => !base.has(`${e.contentId}/${e.bookId}`)).length, 80);
  assert.ok(recitations.entries.filter(e => e.bookId === 'chinese-4b-sample').every(e => get(e.contentId).recitationRequirements.some(r => /旧版参考/.test(r.label))));
});

test('English guides are unique, sourced, usable and distinguish irregular forms and sense-specific variants', () => {
  assert.equal(english.entries.length, 644);
  assert.equal(new Set(english.entries.map(e => e.contentId)).size, 644);
  const patterns = english.entries.flatMap(e => e.patterns);
  assert.equal(patterns.length, 118); assert.equal(new Set(patterns.map(p => p.pattern)).size, 118);
  assert.equal(english.entries.flatMap(e => e.families).length, 77);
  for (const entry of english.entries) {
    const item = learning.catalogById.get(entry.contentId);
    assert.ok([item.title, ...(item.aliases || [])].includes(entry.lemma), entry.contentId);
    assert.equal(new Set(entry.forms.map(f => f.label)).size, entry.forms.length, entry.contentId);
    assert.ok(entry.sourceIds.length); assert.ok(entry.sourceIds.every(id => english.sources[id]));
    assert.ok(item.studyNotes.exercises.every(ex => ex.question && ex.answer));
    assert.match(item.studyNotes.notice, /不代表这些拓展用法都出自该册/);
    for (const pattern of entry.patterns) for (const key of ['pattern', 'meaning', 'example', 'translation', 'note']) assert.ok(pattern[key], entry.lemma);
  }
  const word = lemma => english.entries.find(e => e.lemma === lemma);
  const form = (lemma, label) => word(lemma).forms.find(f => f.label === label).value;
  assert.equal(form('sheep', '名词复数（可数义）'), 'sheep');
  assert.equal(form('bite', '动词过去分词'), 'bitten');
  assert.equal(form('be', '动词过去式'), 'was / were');
  assert.equal(form('lie', '动词过去分词'), 'lain');
  assert.equal(form('lay', '动词过去式'), 'laid');
  assert.equal(form('found', '动词过去式'), 'founded');
  assert.equal(form('hang', '动词过去分词'), 'hung');
  assert.equal(form('deal', '动词过去分词'), 'dealt');
  assert.match(word('read').pitfalls.join(' '), /riːd.*red/);
  assert.match(word('lie').pitfalls.join(' '), /lied/);
  assert.match(learning.catalogById.get('word-lie').studyNotes.exercises[0].question, /lie（躺、位于）/);
  assert.match(learning.catalogById.get('word-found').studyNotes.exercises[0].question, /found（建立）/);
  assert.match(word('practice').patterns[0].note, /英式.*practise/);
});

test('search finds attached phrases, inflections and word families without assigning unverified grades', () => {
  for (const [query, id] of [['look forward to doing', 'word-look'], ['bitten', 'sh54-word-bite'], ['happiness', 'word-happy'], ['hung', 'word-hang']])
    assert.ok(learning.searchCatalog({ query }).some(i => i.id === id), query);
  const unmapped = english.entries.map(e => learning.catalogById.get(e.contentId)).find(i => !i.gradeMappings?.length);
  assert.ok(unmapped);
  for (let grade = 1; grade <= 9; grade++) assert.ok(!learning.searchCatalog({ query: unmapped.title, grade }).some(i => i.id === unmapped.id));
});

test('old completed snapshots get current display notes without changing snapshots, dates, mastery or storage size', () => {
  const current = learning.catalogById.get('word-read');
  const task = { ...learning.taskFrom(current, 'child', 'old-task', 'manual'), detail: '此前保存的正文', done: true };
  const ledger = { records: {} };
  learning.recordTasks(ledger, [task], '2026-10-12'); ledger.records[current.id].mastered = true;
  const before = JSON.stringify({ task, ledger });
  const display = decorate(task);
  assert.equal(display.detail, '此前保存的正文'); assert.deepEqual(display.studyNotes, current.studyNotes);
  assert.equal(JSON.stringify({ task, ledger }), before);
  assert.ok(!JSON.stringify({ task, ledger }).includes('studyNotes'));
  assert.equal(learning.learningStatus(ledger).items[0].learnedCount, 1);
  assert.equal(learning.learningStatus(ledger).items[0].mastered, true);
  assert.equal(decorate({ id: 'parent-custom', kind: 'word', title: 'read', detail: '自建同名练习' }).studyNotes, undefined);
});

test('library and study disclose notes and answers locally without enqueuing completion', t => {
  const copies = []; global.wx = { setClipboardData: value => copies.push(value.data) };
  t.after(() => { delete global.Page; delete global.wx; });
  for (const name of ['library', 'study']) {
    let definition; global.Page = value => { definition = value; };
    const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    assert.equal(page.data.notesOpenId, ''); assert.equal(page.data.notesAnswersId, '');
    page.toggleStudyAnswers(event('word-read')); assert.equal(page.data.notesAnswersId, '');
    page.toggleStudyNotes(event('word-read')); assert.equal(page.data.notesOpenId, 'word-read');
    page.toggleStudyAnswers(event('word-read')); assert.equal(page.data.notesAnswersId, 'word-read');
    page.toggleStudyNotes(event('word-lie')); assert.equal(page.data.notesAnswersId, '');
    page.toggleStudyNotes(event('word-lie')); assert.equal(page.data.notesOpenId, '');
    const url = english.sources.verbs.url;
    page.copyStudySource({ currentTarget: { dataset: { url } } });
    page.copyStudySource({ currentTarget: { dataset: { url: 'javascript:alert(1)' } } });
    assert.equal(copies.at(-1), url);
  }
  assert.equal(copies.length, 2);
});

test('supplemented tasks sync normally across two parents and never copy guide bodies into the write queue or ledger', async () => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, date = '2026-10-12';
  await f.call('parent-a', 'saveAutoPlans', { familyId: family.id, childId, rules: learning.emptyRules() });
  for (const contentId of ['word-read', 'sh54-sima-guang']) await f.call('parent-a', 'assignContent', { familyId: family.id, childId, contentId, date });
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const task of a.engine.viewDay(date).tasks) {
    assert.ok(decorate(task).studyNotes); assert.equal(task.studyNotes, undefined);
    a.engine.enqueue(date, task.id, true);
  }
  assert.ok(!JSON.stringify(a.engine.snapshot().queue).includes('studyNotes'));
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(t => t.done));
  const status = await b.engine.getLearningStatus({ childId });
  assert.equal(status.items.length, 2); assert.ok(status.items.every(i => i.learnedCount === 1));
  assert.ok(!JSON.stringify(status).includes('studyNotes'));
});
