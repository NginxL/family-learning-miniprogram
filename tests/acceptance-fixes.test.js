const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const { fixture: serviceFixture } = require('./helpers');
const { fixture, hash, beforeAcceptance } = require('./acceptance-baseline-helper');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const { createDemo } = require('../miniprogram/lib/demo');
const vocabulary = require('../scripts/english-vocabulary');
const supplements = require('../data/catalogs/chinese-classical-supplements.json').entries;
const structures = require('../data/catalogs/english-structure-supplements.json').entries;
const dictionary = require('../data/catalogs/english-dictionary-senses.json').entries;
const dictionaryProof = require('../data/catalogs/english-dictionary-sense-evidence.json').entries;
const get = id => learning.catalogById.get(id);
const ruleSet = (policy, mode = 'new', quantity = 3) => learning.emptyRules().map(r => r.kind === 'poetry'
  ? { ...r, scope: 'all', quantity, mode, ...(policy === undefined ? {} : { recitationPolicy: policy }) } : r);
const policyOf = (family, child) => learning.activeTemplate(family, child).rules.find(r => r.kind === 'poetry').recitationPolicy;
const supplement = id => supplements.find(e => e.contentId === id);

test('acceptance corrections preserve every 997576c content ID, order, mapping and non-display field', () => {
  assert.equal(learning.catalog.length, 4239);
  assert.equal(hash(learning.catalog.map(i => i.id)), fixture.idsSha256);
  assert.equal(hash(learning.catalog.map(beforeAcceptance)), fixture.catalogSha256);
  const allowed = ['detail', 'textSourceUrl', 'note', 'studyNotes', 'recitationPractice', 'textRevision', 'commonSenseSources'];
  for (const patch of fixture.patches) for (const field of Object.keys(patch.fields)) assert.ok(allowed.includes(field), field);
  for (const patch of fixture.patches.filter(p => ['textSourceUrl', 'note', 'textRevision', 'recitationPractice'].some(f => f in p.fields)))
    assert.equal(patch.id, 'moe-2022-zh-1-6-045');
});

test('山行正文、默写答案都用生；旧任务不改写而能查看校订正文', () => {
  const item = get('moe-2022-zh-1-6-045');
  assert.match(item.detail, /白云生处有人家/); assert.doesNotMatch(item.detail, /白云深处/);
  const exercise = item.studyNotes.exercises.find(e => e.question.includes('遮住正文'));
  assert.match(exercise.answer, /白云生处/); assert.doesNotMatch(exercise.answer, /白云深处/);
  const task = { ...learning.taskFrom(item, 'child', 'saved', 'manual'), detail: item.detail.replace('白云生处', '白云深处'), done: true };
  const ledger = { records: {} }; learning.recordTasks(ledger, [task], '2026-10-19');
  const saved = JSON.stringify({ task, ledger }); const view = withContentSources(task);
  assert.match(view.textCorrectionNotice, /正文已校订/); assert.match(view.correctedDetail, /白云生处/);
  assert.match(view.detail, /白云深处/); assert.equal(JSON.stringify({ task, ledger }), saved);
  assert.equal(withContentSources(item).textCorrectionNotice, '');
});

test('classical corrections use the actual quoted context and do not invent a textbook pronunciation', () => {
  const ma = JSON.stringify(get('moe-2022-zh-7-9-052').studyNotes);
  assert.doesNotMatch(ma, /dàn/); assert.match(ma, /容量单位/);
  const cases = [
    ['sh54-huoban', /每韵为一帖/, /每字为一帖/],
    ['sh54-yugong-yishan', /公孙衍、张仪岂不诚大丈夫哉/, /诚不欺孤/],
    ['moe-2022-zh-7-9-050', /高峰入云.*进入/, /入：到来/],
    ['moe-2022-zh-7-9-054', /悄怆.*凄凉/, /悄怆.*忧伤/],
    ['moe-2022-zh-7-9-055', /其必曰/, /其喜洋洋者矣.*表.*揣度/]
  ];
  for (const [id, yes, no] of cases) { const text = JSON.stringify(supplement(id)); assert.match(text, yes, id); assert.doesNotMatch(text, no, id); }
  assert.doesNotMatch(supplements.find(s => get(s.contentId).title.includes('唐雎')).culture, /足下/);
  assert.doesNotMatch(supplements.find(s => get(s.contentId).title.includes('曹冲')).culture, /斛/);
  assert.match(supplement('sh54-chenshe-shijia').culture, /志向远大的人/);
  assert.match(supplement('sh54-dadao-zhixing').exercises[0].answer, /父母/);
  assert.match(JSON.stringify(supplement('moe-2022-zh-7-9-056').exercises), /未给|自编|可.*结合/);
});

test('classical core notes and stand-alone exercises no longer contradict the corrected annotations', () => {
  const cases = [
    ['sh54-mengzi-fugui', /诚.*确实/, /诚：真正/],
    ['moe-2022-zh-7-9-060', /更定.*八时/, /更定.*初更/],
    ['sh54-qiren-youtian', /中伤.*伤害/, /中伤：击中/],
    ['sh54-archery', /子.*您/, /子：你/],
    ['sh54-zhou-yafu', /介胄.*用作动词.*披.*戴/, /介胄：铠甲和头盔\\n/],
    ['moe-2022-zh-7-9-044', /怒.*奋力/, /怒：振奋/],
    ['sh54-two-children', /智慧/, /谁说你知道得多/],
    ['sh54-chenshe-shijia', /鸿鹄.*志向远大的人/, /鸿鹄：比喻远大志向/]
  ];
  for (const [id, yes, no] of cases) {
    const notes = JSON.stringify(get(id).studyNotes); assert.match(notes, yes, id); assert.doesNotMatch(notes, no, id);
  }
  assert.match(JSON.stringify(get('moe-2022-zh-7-9-044').studyNotes), /其正色邪.*选择/);
  for (const entry of supplements) assert.ok(get(entry.contentId).studyNotes.sections.some(s => s.title === '字词补充与跨篇比较'));
});

test('repaired dictionary senses point to the intended meaning and preserve paired headwords', () => {
  const spell = dictionaryProof.spell.senses.find(s => s.partOfSpeech === 'n.');
  assert.equal(spell.senseId, 'oewn-spell__1.10.00..');
  assert.ok(!dictionaryProof.spell.senses.some(s => s.senseId === 'oewn-spell__1.26.00..'));
  const expected = { 'prince / princess': /公主/, 'emperor / empress': /女皇.*皇后/, elder: /年长的/, plastic: /塑料制的/,
    mobile: /手机/, ton: /大量/, pool: /游泳池/, primary: /小学的/, alarm: /闹钟/, wild: /野外/, yet: /conj\. 但是/,
    positive: /积极的/, form: /形式；类型/, social: /社交的/, each: /adv\. 各；每个/ };
  for (const [head, pattern] of Object.entries(expected)) assert.match(dictionary[head].meaning, pattern, head);
  for (const [head, proof] of Object.entries(dictionaryProof)) for (const sense of proof.externalSenses || []) {
    assert.ok(dictionary[head].sources.some(s => s.url === sense.sourceUrl));
    assert.ok(vocabulary.hasSense(dictionary[head].meaning, sense.partOfSpeech, sense.meaning), head);
    assert.equal(new URL(sense.sourceUrl).hostname, 'dictionary.cambridge.org');
  }
  assert.ok(!dictionary.other.sources.some(s => s.url.endsWith('.')));
});

test('word displays deduplicate individual meanings without merging different POS, qualifiers or printed forms', () => {
  assert.deepEqual(vocabulary.splitMeanings('甲（说明一；说明二）；乙'), ['甲（说明一；说明二）', '乙']);
  assert.equal(vocabulary.commonText(['v. 属于', 'v. 属于（常用 belong to）'], []), 'v. 属于（常用 belong to）');
  assert.equal(vocabulary.commonText(['n. 光', 'v. 光'], []), 'n. 光\nv. 光');
  assert.equal(vocabulary.commonText(['v. 打（人）；打（球）'], []), 'v. 打（人）；打（球）');
  const item = { id: 'test-word', kind: 'word', title: 'test-only', detail: '', source: 'fixture', collections: [] };
  const state = new Map([[item.id, { common: ['n. 甲'], hints: [], forms: ['printed-form'], textbook: [
    { form: 'printed-form', partOfSpeech: 'n.', meaning: '甲；乙' },
    { form: 'printed-form', partOfSpeech: 'n.', meaning: '甲；乙' },
    { form: 'test-only', partOfSpeech: 'v.', meaning: '甲' }
  ] }]]);
  vocabulary.finish([item], state);
  assert.match(item.detail, /printed-form · n\. 乙/); assert.doesNotMatch(item.detail, /printed-form · n\. 甲/);
  assert.match(item.detail, /v\. 甲/); assert.equal((item.detail.match(/n\. 乙/g) || []).length, 1);
  const belong = learning.catalog.find(i => i.kind === 'word' && i.title === 'belong');
  assert.equal((belong.detail.split('教材用法：')[0].match(/属于/g) || []).length, 1);
  const report = learning.catalog.find(i => i.kind === 'word' && i.title === 'report');
  const textbook = report.detail.split('教材用法：\n')[1];
  assert.match(textbook, /v\. 汇报/); assert.match(textbook, /n\. 汇报；报道；调查报告/);
  assert.doesNotMatch(textbook, /(?:v|n)\. 报告|；报告(?:；|$)/);
});

test('sentence practice accepts alternative answers and source addresses name their actual topics', () => {
  const by = Object.fromEntries(structures.map(s => [s.lemma, s]));
  assert.match(by.teach.exercise.question, /自学/);
  assert.match(by.begin.exercise.answer, /started to rain.*started raining/);
  assert.match(by.keep.exercise.answer, /have kept.*have had/);
  assert.doesNotMatch(by.watch.exercise.question, /选择/); assert.match(by.win.exercise.question, /last week/);
  assert.match(by.keep.note, /约定借期/);
  for (const e of structures) for (const source of e.sources) assert.doesNotMatch(source.url, /\/(?:verb-ing|main|it-as-empty-subject|transitive-and-intransitive-verbs|have-something-|let)$|\.$/);
  for (const [head, slug] of [['hope','expect-hope-or-wait'], ['sound','verbs-types'], ['help','help-somebody-to-do']])
    assert.ok(by[head].sources.some(s => s.url.endsWith('/' + slug)));
});

test('required plans advance through current textbook grades and semesters; historical requirements stay selectable by book', () => {
  const list = learning.recitationPool(learning.catalog.filter(i => i.kind === 'poetry'), 'only');
  assert.equal(list.length, 104);
  const ranks = list.map(item => Math.min(...item.gradeMappings.filter(m => m.editionStatus !== 'historical_reference'
    && item.recitationRequirements.some(r => r.bookId === m.bookId && r.requirement.startsWith('背诵')))
    .map(m => m.grade * 10 + (m.semester === '下册' ? 1 : 0))));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const title of ['凉州词','出塞']) assert.ok(list.findIndex(i => i.title.includes(title)) > list.findIndex(i => i.title.includes('鹿柴')), title);
  assert.ok(!list.some(i => i.title.includes('芙蓉楼送辛渐')), 'only a historical requirement is currently recorded for this poem');
  const oldOnly = get('moe-2022-zh-7-9-036');
  assert.equal(learning.hasRecitation(oldOnly), false);
  assert.equal(learning.hasRecitation(oldOnly, { bookId: 'chinese-9a', recitation: 'familiar' }), true);
  const historical = oldOnly.recitationRequirements.find(r => r.requirement.startsWith('背诵'));
  assert.equal(learning.hasRecitation(oldOnly, { bookId: historical.bookId }), true);
  const reverse = list.slice(0, 3).reverse();
  assert.deepEqual(learning.recitationPool(reverse, 'only', false), reverse, 'review order remains oldest-first, not grade order');
});

for (const mode of ['service', 'demo']) test(`${mode}: older clients preserve missing policies; explicit all resets; receipt retries stay idempotent`, async () => {
  let family, call;
  if (mode === 'service') {
    const f = serviceFixture(); family = await f.family(); await f.addParent(family.id);
    call = (action, input) => f.call('parent-a', action, input);
  } else {
    const store = new Map(); const transport = createDemo({ getStorageSync: k => store.get(k), setStorageSync: (k,v) => store.set(k,v) });
    family = (await transport('bootstrap', { ensureDefault: true })).family; call = transport;
  }
  const childId = family.children[0].id, familyId = family.id;
  const save = (baseRevision, policy, mutationId = 'm' + baseRevision) => ({ familyId, childId, templateId: 'review-required', name: '必背', activate: true,
    baseRevision, mutationId, rules: ruleSet(policy) });
  let result = await call('saveDailyTemplate', save(0, 'only'));
  assert.equal(policyOf(result.family, childId), 'only');
  const oldRequest = save(1, undefined);
  result = await call('saveDailyTemplate', oldRequest);
  assert.equal(policyOf(result.family, childId), 'only');
  result = await call('saveDailyTemplate', save(2, 'all'));
  assert.equal(policyOf(result.family, childId), 'all');
  result = await call('saveDailyTemplate', oldRequest);
  assert.equal(result.duplicate, true); assert.equal(policyOf(result.family, childId), 'all');
  await call('saveDailyTemplate', save(3, 'first'));
  result = await call('saveAutoPlans', { familyId, childId, rules: ruleSet(undefined) });
  assert.equal(policyOf(result.family, childId), 'first');
  result = await call('saveAutoPlans', { familyId, childId, rules: ruleSet('all') });
  assert.equal(policyOf(result.family, childId), 'all');
});

test('same-position full work and excerpt count once without changing either learning record', () => {
  const full = get('moe-2022-zh-1-6-037'), excerpt = get('sh54-grass-excerpt');
  const empty = learning.progress({ records: {} });
  for (const ids of [[full.id], [excerpt.id], [full.id, excerpt.id]]) {
    const ledger = { records: {} };
    for (const id of ids) learning.recordTasks(ledger, [{ ...learning.taskFrom(get(id), 'c', 't-' + id, 'manual'), done: true }], '2026-10-19');
    const before = JSON.stringify(ledger); const progress = learning.progress(ledger);
    assert.equal(progress.grades[1].learned, 1); assert.equal(progress.grades[1].total, empty.grades[1].total);
    assert.equal(progress.stats.learned, ids.length); assert.equal(JSON.stringify(ledger), before);
    assert.equal(learning.learningStatus(ledger).items.some(i => i.contentId === full.id), ids.includes(full.id));
  }
});

test('switching the template picker from only to all sends an explicit reset', async t => {
  const f = serviceFixture(), family = await f.family(), child = family.children[0].id;
  const { engine } = f.client('parent-a'); await engine.sync('2026-10-12');
  await engine.command('saveAutoPlans', { childId: child, rules: ruleSet('only') });
  let page; global.Page = p => { page = p; }; global.getApp = () => ({ engine, mode: 'demo' });
  global.wx = { showToast() {} };
  const file = require.resolve('../miniprogram/pages/plans/index'); delete require.cache[file]; require(file);
  const ui = { ...page, engine, active: true, data: structuredClone(page.data), setData(p) { Object.assign(this.data, p); } };
  t.after(() => { ui.cleanup(); delete global.Page; delete global.getApp; delete global.wx; });
  ui.render(); ui.openTemplate(); ui.changeRecitationPolicy({ detail: { value: 0 } }); await ui.saveAndUseTemplate();
  assert.equal(policyOf(engine.state.family, child), 'all');
});
