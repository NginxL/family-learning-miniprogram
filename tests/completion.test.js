const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const learning = require('../shared/learning');
const requirements = require('../data/catalogs/chinese-recitation-requirements.json').entries;
const supplements = require('../data/catalogs/chinese-classical-supplements.json').entries;
const senses = require('../data/catalogs/english-dictionary-senses.json').entries;
const senseProof = require('../data/catalogs/english-dictionary-sense-evidence.json');
const structures = require('../data/catalogs/english-structure-supplements.json').entries;
const { hasSense } = require('../scripts/english-vocabulary');
const { fixture, memoryStorage } = require('./helpers');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { createDemo } = require('../miniprogram/lib/demo');
const { fixture: baseline, beforeCompletion, isPriorContent, assertProgressDelta, hash } = require('./completion-baseline-helper');
const sha = text => createHash('sha256').update(text).digest('hex');
const get = id => learning.catalogById.get(id);
const word = lemma => learning.catalog.find(i => i.kind === 'word' && [i.title, ...(i.aliases || [])].includes(lemma));
const rules = (policy = 'all', mode = 'new', quantity = 3) => learning.emptyRules().map(r => r.kind === 'poetry'
  ? { ...r, scope: 'all', quantity, mode, recitationPolicy: policy } : r);
const familyFor = rules => ({ children: [{ id: 'c' }], plans: [], autoPlans: { c: rules } });
const dayFor = (family, ledger = { records: {} }, date = '2026-10-20') => learning.generateDay(family, { date, tasks: [] }, { c: ledger }, true);

test('completion additions preserve all 4234 existing IDs, order and every field outside the explicit review patch', () => {
  const prior = learning.catalog.filter(isPriorContent);
  assert.equal(prior.length, baseline.catalogCount);
  assert.equal(hash(prior.map(i => i.id)), baseline.idsSha256);
  assert.equal(hash(prior.map(beforeCompletion)), baseline.catalogSha256);
  assert.deepEqual(learning.catalog.filter(i => !isPriorContent(i)).map(i => i.id), baseline.addedIds);
  assertProgressDelta(learning.progress({ records: {} }));
  assert.equal(hash(baseline.beforeProgress), require('./fixtures/placement-baseline.json').progressSha256);
  for (const patch of baseline.patches) for (const field of Object.keys(patch.fields)) {
    assert.ok(['detail', 'studyNotes', 'recitationPractice', 'commonSenseSources', 'coveredContentIds'].includes(field));
    if (field === 'detail' && get(patch.id).kind !== 'word')
      assert.ok(['skill-zh-sh54-yu-zhu-yuansi', 'skill-zh-sh54-mengzi-dedao'].includes(patch.id));
    if (field === 'coveredContentIds') assert.equal(patch.id, 'moe-2022-zh-1-6-037');
  }
});

test('required and familiar filters honor the selected edition, grade, semester and unit independently', () => {
  const current = r => get(r.contentId).gradeMappings.some(m => m.bookId === r.bookId && m.editionStatus !== 'historical_reference');
  const requiredIds = new Set(requirements.filter(r => r.requirement.startsWith('背诵') && current(r)).map(r => r.contentId));
  assert.deepEqual(new Set(learning.searchCatalog({ recitation: 'required' }).map(i => i.id)), requiredIds);
  assert.deepEqual(new Set(learning.searchCatalog({ recitation: 'familiar' }).map(i => i.id)),
    new Set(requirements.filter(r => r.requirement === '熟读成诵' && current(r)).map(r => r.contentId)));
  for (const entry of requirements) {
    const mapping = get(entry.contentId).gradeMappings.find(m => m.bookId === entry.bookId);
    const query = { recitation: entry.requirement === '熟读成诵' ? 'familiar' : 'required',
      bookId: entry.bookId, grade: mapping.grade, semester: mapping.semester, unitId: mapping.unitId };
    assert.ok(learning.searchCatalog(query).some(i => i.id === entry.contentId));
    assert.ok(!learning.searchCatalog({ ...query, semester: mapping.semester === '上册' ? '下册' : '上册' }).some(i => i.id === entry.contentId));
  }
  const yuqu = 'moe-2022-zh-7-9-036';
  assert.ok(!learning.hasRecitation({ id: yuqu }, { bookId: 'chinese-9a', recitation: 'required' }));
  assert.ok(learning.hasRecitation({ id: yuqu }, { bookId: 'chinese-9a', recitation: 'familiar' }));
  assert.equal(learning.hasRecitation({ id: 'sh54-grass-excerpt' }), false);
});

test('132 scoped self-tests use exact corrected text and never silently turn optional dictation into a textbook requirement', () => {
  let count = 0;
  for (const entry of requirements.filter(r => r.requirement.startsWith('背诵'))) {
    const item = get(entry.contentId), proof = item.recitationPractice.find(p => p.bookId === entry.bookId);
    const body = item.author && item.detail.startsWith(item.author + '\n') ? item.detail.slice(item.author.length + 1) : item.detail;
    const from = entry.start ? body.indexOf(entry.start) : 0;
    const until = entry.end ? body.indexOf(entry.end, from) + entry.end.length : body.length;
    assert.ok(from >= 0 && until > from);
    const answer = body.slice(from, until);
    assert.equal(proof.answerSha256, sha(answer)); assert.equal(proof.requirement, entry.requirement);
    const exercise = item.studyNotes.exercises.find(e => e.question.includes('遮住正文') && e.answer === answer);
    assert.ok(exercise, entry.contentId);
    if (!entry.requirement.includes('默写')) assert.match(exercise.question, /教材此条未要求默写/);
    else assert.match(exercise.question, /背诵并默写/);
    count++;
  }
  assert.equal(count, 132);
  const song = get('sh54-songdongyang-textbook');
  assert.ok(song.studyNotes.exercises.some(e => e.answer.endsWith('况才之过于余者乎？') && !e.answer.includes('今诸生学于太学')));
  const fugui = get('sh54-mengzi-fugui').studyNotes.exercises.find(e => e.question.includes('遮住正文'));
  assert.ok(fugui.answer.startsWith('居天下之广居')); assert.ok(!fugui.answer.includes('景春曰'));
});

test('the four-line grass excerpt has official scope, independent records and one-way full-text completion', () => {
  const excerpt = get('sh54-grass-excerpt'), full = get('moe-2022-zh-1-6-037');
  const proof = require('../data/catalogs/chinese-excerpt-evidence.json').entries[0];
  assert.equal(excerpt.workId, full.id); assert.equal(excerpt.minimumServiceVersion, 1);
  assert.equal(excerpt.gradeMappings.length, 1); assert.equal(excerpt.gradeMappings[0].sourceUrl, proof.sourceUrl);
  assert.equal(excerpt.gradeMappings[0].sourcePrintPage, 12); assert.equal(excerpt.gradeMappings[0].sourcePdfPage, 17);
  assert.equal(excerpt.gradeMappings[0].sourceKind, 'official_textbook');
  assert.equal(excerpt.recitationRequirements, undefined); assert.equal(excerpt.coveredContentIds, undefined);
  assert.doesNotMatch(excerpt.detail, /远芳侵古道|又送王孙去/);
  const ledger = { records: {} };
  learning.recordTasks(ledger, [{ ...learning.taskFrom(excerpt, 'c', 'excerpt', 'manual'), done: true }], '2026-10-19');
  ledger.records[excerpt.id].mastered = true;
  assert.deepEqual(learning.learningStatus(ledger).items.map(i => i.contentId), [excerpt.id]);
  const before = JSON.stringify(ledger);
  const fresh = dayFor(familyFor(rules('all', 'new', 10000)), ledger);
  assert.ok(!fresh.tasks.some(t => t.contentId === full.id));
  assert.equal(JSON.stringify({ records: { [excerpt.id]: ledger.records[excerpt.id] } }), before);
  const fullLedger = { records: {} };
  learning.recordTasks(fullLedger, [{ ...learning.taskFrom(full, 'c', 'full', 'manual'), done: true }], '2026-10-18');
  fullLedger.records[full.id].mastered = true; const saved = JSON.stringify(fullLedger);
  assert.equal(learning.learningStatus(fullLedger).items.find(i => i.contentId === excerpt.id).mastered, false);
  assert.equal(JSON.stringify(fullLedger), saved); assert.equal(fullLedger.records[excerpt.id], undefined);
});

test('required-only and priority planning preserve quantity, new/review semantics, reservations and completed snapshots', () => {
  const only = dayFor(familyFor(rules('only')));
  assert.equal(only.tasks.length, 3); assert.ok(only.tasks.every(t => learning.hasRecitation({ id: t.contentId })));
  const first = dayFor(familyFor(rules('first')));
  assert.ok(first.tasks.every(t => learning.hasRecitation({ id: t.contentId })));
  const family = familyFor(rules('only')), ledger = { records: {} };
  const completed = { ...only.tasks[0], done: true };
  learning.recordTasks(ledger, [completed], '2026-10-18'); ledger.records[completed.contentId].mastered = true;
  family.scheduledContents = [{ childId: 'c', contentId: only.tasks[1].contentId, date: '2026-11-01' }];
  const fresh = dayFor(family, ledger);
  assert.ok(!fresh.tasks.some(t => [completed.contentId, only.tasks[1].contentId].includes(t.contentId)));
  const saved = structuredClone(ledger.records[completed.contentId]);
  const review = dayFor(familyFor(rules('only', 'review')), ledger);
  assert.equal(review.tasks.length, 1); assert.equal(review.tasks[0].contentId, completed.contentId);
  assert.match(review.warnings[0].message, /已学内容不足/);
  for (const field of ['item', 'firstSeen', 'completedDates', 'mastered', 'version']) assert.deepEqual(ledger.records[completed.contentId][field], saved[field]);
  assert.match(learning.templateSummary(rules('only')), /只选教材必背/);
  assert.match(learning.templateSummary(rules('first', 'review')), /复习，教材必背优先/);
});

test('stored weekly templates carry recitation policy across parents while today and the learning ledger stay intact', async () => {
  const f = fixture(), family = await f.family(), childId = family.children[0].id;
  await f.addParent(family.id); const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync('2026-10-12');
  const snapshot = structuredClone(a.engine.viewDay('2026-10-12').tasks);
  const command = async (action, payload) => a.engine.command(action, { childId, ...payload });
  await command('saveDailyTemplate', { templateId: 'required', name: '必背日', rules: rules('only'), baseRevision: 0, mutationId: 'required', activate: true });
  await command('saveDailyTemplate', { templateId: 'priority', name: '周末', rules: rules('first'), baseRevision: 1, mutationId: 'priority', activate: false });
  await command('saveTemplateSchedule', { activeId: 'required', weeklySchedule: { weekdaysTemplateId: 'required', weekendTemplateId: 'priority' }, baseRevision: 2, mutationId: 'weekly' });
  await b.engine.sync('2026-10-13');
  assert.equal(b.engine.state.family.recitationPlanningVersion, 1);
  assert.equal(learning.templateForDate(b.engine.state.family, childId, '2026-10-17').rules.find(r => r.kind === 'poetry').recitationPolicy, 'first');
  assert.ok(b.engine.viewDay('2026-10-13').tasks.every(t => learning.hasRecitation({ id: t.contentId })));
  await a.engine.sync('2026-10-12'); assert.deepEqual(a.engine.viewDay('2026-10-12').tasks, snapshot);
  const before = f.inspect();
  for (const invalid of [rules('bogus'), rules().map(r => r.kind === 'word' ? { ...r, recitationPolicy: 'only' } : r)])
    await assert.rejects(f.call('parent-a', 'saveAutoPlans', { familyId: family.id, childId, rules: invalid }), { code: 'INVALID' });
  assert.deepEqual(f.inspect(), before);
});

test('old-cloud clients reject new capabilities before writes and keep existing check-in transport available', async () => {
  const f = fixture(); await f.family(); const client = f.client('parent-a'); await client.engine.sync('2026-10-12');
  const state = structuredClone(client.engine.state); delete state.family.recitationPlanningVersion;
  const storage = memoryStorage(); storage.write(state); let calls = 0;
  const engine = new SyncEngine({ storage, transport: async () => { calls++; throw Error('Existing transport reached'); } });
  for (const action of ['saveDailyTemplate', 'saveAutoPlans'])
    await assert.rejects(engine.command(action, { childId: state.family.children[0].id, rules: rules('only') }), { code: 'UNSUPPORTED' });
  for (const contentId of baseline.addedIds) for (const action of ['assignContent', 'reviewContent'])
    await assert.rejects(engine.command(action, { childId: state.family.children[0].id, contentId, date: '2026-10-13' }), { code: 'UNSUPPORTED' });
  assert.equal(calls, 0); assert.deepEqual(storage.read(), state);
  await assert.rejects(engine.command('assignContent', { childId: state.family.children[0].id, contentId: 'poem-goose', date: '2026-10-13' }), /Existing transport reached/);
  assert.equal(calls, 1);
});

test('demo supports required planning and the new excerpt without any online service', async () => {
  const store = new Map(), transport = createDemo({ getStorageSync: key => store.get(key), setStorageSync: (key, value) => store.set(key, value) });
  const initial = await transport('bootstrap', { ensureDefault: true }); const familyId = initial.family.id, childId = initial.family.children[0].id;
  assert.equal(initial.family.recitationPlanningVersion, 1);
  await transport('saveAutoPlans', { familyId, childId, rules: rules('only') });
  const day = (await transport('getDay', { familyId, date: initial.today })).day;
  assert.ok(day.tasks.filter(t => t.kind === 'poetry').every(t => learning.hasRecitation({ id: t.contentId })));
  await transport('assignContent', { familyId, childId, contentId: 'sh54-grass-excerpt', date: initial.today });
  assert.ok((await transport('getDay', { familyId, date: initial.today })).day.tasks.some(t => t.contentId === 'sh54-grass-excerpt'));
});

test('55 classical supplements cover the reported vocabulary gaps, cultural notes and transfer practice with source boundaries', () => {
  assert.equal(supplements.length, 55); assert.equal(new Set(supplements.map(e => e.contentId)).size, 55);
  for (const entry of supplements) {
    const item = get(entry.contentId);
    assert.ok(entry.words.length && entry.culture && entry.exercises.length);
    for (const w of entry.words) assert.ok(w.text && w.meaning);
    for (const e of entry.exercises) assert.ok(e.question && e.answer);
    assert.ok(item.studyNotes.sections.some(s => s.title === '文化与阅读提示' && s.body === entry.culture));
    if (entry.bookId) {
      assert.ok(entry.pages.length); assert.ok(['basic.smartedu.cn', 'book.pep.com.cn'].includes(new URL(entry.sourceUrl).hostname));
      for (const p of entry.pages) assert.ok(p.sourcePdfPage > p.sourcePrintPage);
    } else { assert.equal(item.gradeMappings.length, 0); assert.match(entry.evidence, /待核实/); }
  }
  const required = {
    'sh54-yugong-yishan': ['且','指','易','止','苦','诚','亡','反','陇'],
    'moe-2022-zh-7-9-054': ['西','斗','蛇','犬牙','凄、寒','尤','澈'],
    'sh54-chenshe-shijia': ['次','等','数（shuò）','书','適','唱','被','罾'],
    'moe-2022-zh-7-9-048': ['异同','痛恨','感激','开张','卑鄙'],
    'sh54-hezhouji': ['简','修狭','夷','类','数量表达']
  };
  for (const [id, words] of Object.entries(required)) for (const w of words)
    assert.ok(supplements.find(e => e.contentId === id).words.some(row => row.text.startsWith(w)), `${id}: ${w}`);
  for (const id of baseline.addedIds.filter(i => i.startsWith('skill-'))) {
    assert.equal(get(id).manualOnly, true); assert.equal(get(id).learningArea, 'classical'); assert.equal(get(id).coveredContentIds, undefined);
  }
});

test('982 remaining dictionary-backed cards gain sourced senses while function words keep their grammatical POS', () => {
  assert.equal(Object.keys(senses).length, 982); assert.deepEqual(Object.keys(senses), Object.keys(senseProof.entries));
  assert.equal(learning.catalog.filter(i => i.dictionaryReference && !i.commonSenseSources?.length).length, 0);
  for (const [head, entry] of Object.entries(senses)) {
    const item = word(head), proof = senseProof.entries[head]; assert.ok(item, head);
    for (const line of entry.meaning.split('\n')) {
      const match = line.match(/^((?:modal v|[a-z]+)\.) (.+)$/); assert.ok(match, head);
      assert.ok(hasSense(item.detail, match[1], match[2]), head + ': ' + line);
    }
    assert.ok(entry.sources.length); assert.ok(proof.source);
    if (proof.senses) for (const s of proof.senses) { assert.match(s.senseId, /^oewn-/); assert.match(s.synset, /^oewn-\d+-[nvars]$/); assert.match(s.definitionSha256, /^[a-f0-9]{64}$/); }
    else assert.ok(proof.sourceUrl.startsWith('https://'));
  }
  for (const [head, pos, meaning] of [['mine','pron.','我的'], ['unless','conj.','除非'], ['would','modal v.','将会'], ['article','n.','冠词'], ['area','n.','面积']])
    assert.ok(word(head).detail.includes(meaning) && word(head).detail.includes(pos), head);
  assert.match(senseProof.sourceSha256, /^[a-f0-9]{64}$/); assert.match(senseProof.attribution, /Princeton.*CC BY 4.0/);
});

test('45 structure groups have original examples and exercises, distinct grammar sources and no invented textbook units', () => {
  assert.equal(structures.length, 45); assert.equal(new Set(structures.map(e => e.contentId)).size, 45);
  for (const e of structures) {
    const item = get(e.contentId); assert.equal(item.kind, 'word');
    for (const k of ['pattern','meaning','example','translation','note']) assert.ok(e[k]);
    assert.ok(e.sources.every(s => ['dictionary.cambridge.org','www.collinsdictionary.com','learnenglish.britishcouncil.org'].includes(new URL(s.url).hostname)));
    assert.ok(item.studyNotes.exercises.some(q => q.question === e.exercise.question && q.answer === e.exercise.answer));
    assert.match(item.studyNotes.notice, /不代表|不代表这些/);
  }
  for (const lemma of ['let','have','find','watch','notice','number','rise','allow','mind','keep']) assert.ok(structures.some(s => s.lemma === lemma));
  assert.match(structures.find(s => s.lemma === 'dream').exercise.answer, /travelling \/ traveling/);
  assert.match(structures.find(s => s.lemma === 'worry').exercise.answer, /worried.*\/.*worries/);
});

function loadUi(name, engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
}

test('required template picker saves the policy and carries the matching catalogue filter through navigation', async t => {
  const f = fixture(), family = await f.family(), { engine } = f.client('parent-a'); await engine.sync('2026-10-13');
  const app = { engine, mode: 'demo', navigation: {} }, tabs = [];
  global.getApp = () => app; global.wx = { showToast() {}, switchTab: value => tabs.push(value.url) };
  const plans = loadUi('plans', engine); plans.render();
  const library = loadUi('library', engine);
  t.after(() => { plans.cleanup(); library.cleanup(); delete global.Page; delete global.getApp; delete global.wx; });
  plans.openTemplate(); plans.changeRecitationPolicy({ detail: { value: 2 } });
  const selected = plans.data.rules.find(r => r.id === 'poetry');
  assert.equal(selected.recitationPolicy, 'only'); assert.equal(selected.recitationPolicyIndex, 2);
  assert.equal(selected.poolCount, learning.materialPool(family, family.children[0].id, selected.scope).filter(i => i.kind === 'poetry' && learning.hasRecitation(i)).length);
  await plans.saveAndUseTemplate();
  assert.equal(learning.activeTemplate(engine.state.family, family.children[0].id).rules.find(r => r.kind === 'poetry').recitationPolicy, 'only');
  plans.browseRule({ currentTarget: { dataset: { id: 'poetry' } } });
  assert.deepEqual(tabs, ['/pages/library/index']); assert.equal(app.navigation.libraryRecitation, 'required');
  library.refresh = async () => {}; library.loadLearningStatus = async () => {};
  library.onShow();
  assert.equal(library.data.recitationIndex, 1); assert.equal(app.navigation.libraryRecitation, undefined);
  assert.equal(library.data.total, selected.poolCount); assert.ok(library.data.items.every(item => learning.hasRecitation(item)));
  const before = JSON.stringify(engine.state.family);
  library.changeRecitation({ detail: { value: 99 } }); assert.equal(library.data.recitationIndex, 1);
  library.changeKind({ detail: { value: library.data.kinds.findIndex(k => k.id === 'word') } });
  assert.equal(library.data.recitationIndex, 0); assert.ok(library.data.total > 0);
  library.changeRecitation({ detail: { value: 1 } });
  library.showBook({ currentTarget: { dataset: { id: 'english-9a-2024' } } });
  assert.equal(library.data.recitationIndex, 0); assert.ok(library.data.items.some(i => i.kind === 'word'));
  library.changeLearningArea({ detail: { value: library.data.learningAreas.findIndex(a => a.id === 'classical') } });
  assert.equal(library.data.total, 55); assert.equal(JSON.stringify(engine.state.family), before);
});
