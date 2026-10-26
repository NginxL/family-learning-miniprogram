const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, memoryStorage } = require('./helpers');
const learning = require('../shared/learning');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine, shiftDate } = require('../miniprogram/lib/sync-engine');
const today = '2026-10-12', tomorrow = '2026-10-13';
const rules = quantities => learning.emptyRules().map(rule => ({ ...rule, ...(typeof quantities[rule.kind] === 'number' ? { quantity: quantities[rule.kind] } : quantities[rule.kind] || {}) }));
async function setup() {
  const f = fixture(); const family = await f.family(); const childId = family.children[0].id;
  const call = (action, input = {}, user = 'parent-a') => f.call(user, action, { familyId: family.id, childId, ...input });
  const fresh = async () => (await f.call('parent-a', 'bootstrap', {})).family;
  let counter = 0;
  const command = async (action, values, user = 'parent-a') => {
    const state = learning.templateSet(await fresh(), values.childId || childId);
    return call(action, { baseRevision: state.revision, mutationId: `template_${++counter}`, ...values }, user);
  };
  const day = async date => (await call('getDay', { date })).day;
  return { f, family, childId, call, fresh, command, day };
}
const learningDocs = f => Object.fromEntries(Object.entries(f.inspect()).filter(([key]) => key.startsWith('learning/')));

test('legacy quantities appear as a named default without migrating or resetting household data', async () => {
  const s = await setup(); const original = rules({ poetry: 2, word: 12, sentence: 3 });
  await s.call('saveAutoPlans', { rules: original });
  const family = await s.fresh(); const before = s.f.inspect(); const set = learning.templateSet(family, s.childId);
  assert.equal(set.templates[0].name, '每日积累'); assert.equal(set.revision, 0); assert.deepEqual(set.templates[0].rules, original);
  set.templates[0].rules[0].quantity = 5;
  assert.deepEqual(learning.activeTemplate(family, s.childId).rules, original, 'read helpers never mutate the source');
  assert.deepEqual(s.f.inspect(), before); assert.equal(family.templateSets, undefined);
  assert.equal(learning.ruleRows(family, s.childId).find(row => row.id === 'word').quantity, 12);
});

test('a reusable template controls poems, words, sentences and articles across days; active edits freeze today and preserve completions and manual exceptions', async () => {
  const s = await setup(); const current = await s.day(today); const poem = current.tasks[0];
  await s.call('setTaskDone', { date: today, taskId: poem.id, done: true, baseVersion: 0, mutationId: 'done' });
  const beforeToday = await s.day(today); const ledgerBefore = learningDocs(s.f);
  for (const name of ['A bird', 'A cat']) await s.call('addPlan', { title: name, detail: name+' can play.', kind: 'english-reading', subject: 'english', schedule: 'library', minutes: 3 });
  const saved = await s.command('saveDailyTemplate', { templateId: 'school', name: '上学日', rules: rules({ poetry: 2, word: 4, sentence: 2, 'english-reading': 1 }), activate: true });
  assert.equal(saved.family.templateSets[s.childId].activeId, 'school'); assert.deepEqual((await s.day(today)).tasks, beforeToday.tasks);
  assert.deepEqual(learningDocs(s.f), ledgerBefore);
  let preview = await s.day(tomorrow);
  for (const [kind, count] of Object.entries({ poetry: 2, word: 4, sentence: 2, 'english-reading': 1 })) assert.equal(preview.tasks.filter(task => task.kind === kind).length, count);
  const removed = preview.tasks.find(task => task.kind === 'word');
  await s.call('editPlannedTask', { date: tomorrow, taskId: removed.id, contentId: removed.contentId, baseVersion: 0, planRevision: preview.planRevision || 0, mutationId: 'remove-word' });
  await s.call('assignContent', { date: tomorrow, contentId: 'sh54-jiande' });
  await s.command('saveDailyTemplate', { templateId: 'school', name: '上学日调整', rules: rules({ poetry: 1, word: 6, sentence: 1, 'english-reading': 1 }), activate: false });
  preview = await s.day(tomorrow);
  assert.equal(preview.tasks.filter(task => task.kind === 'word').length, 5); assert.ok(!preview.tasks.some(task => task.id === removed.id));
  assert.ok(preview.tasks.some(task => task.contentId === 'sh54-jiande'));
  assert.deepEqual((await s.day(today)).tasks, beforeToday.tasks); assert.deepEqual(learningDocs(s.f), ledgerBefore);
  s.f.advance(86400000); assert.deepEqual((await s.day(tomorrow)).tasks, preview.tasks);
  const after = await s.day('2026-10-14'); assert.equal(after.tasks.filter(task => task.kind === 'word').length, 6);
  assert.ok(after.tasks.every(task => !preview.tasks.some(old => old.contentId === task.contentId)), 'new pool is reused each day without repeating content');
});

test('inactive saves do not change the active template; switching and deletion are explicit and empty quantities pause generation', async () => {
  const s = await setup(); await s.day(today); const before = await s.day(tomorrow);
  const saved = await s.command('saveDailyTemplate', { templateId: 'rest', name: '休息日', rules: rules({}), activate: false });
  const set = saved.family.templateSets[s.childId]; assert.notEqual(set.activeId, 'rest');
  assert.deepEqual((await s.day(tomorrow)).tasks, before.tasks);
  await s.command('activateDailyTemplate', { templateId: 'rest' }); assert.equal((await s.day(tomorrow)).tasks.length, 0);
  await assert.rejects(s.command('deleteDailyTemplate', { templateId: 'rest' }), { code: 'INVALID' });
  await s.command('deleteDailyTemplate', { templateId: set.activeId });
  const final = learning.templateSet(await s.fresh(), s.childId); assert.equal(final.templates.length, 1); assert.equal(final.activeId, 'rest');
  assert.equal(learning.templateSummary(final.templates[0].rules), '暂停自动安排');
});

test('template writes use per-child revisions and retry receipts: concurrent saves, lost responses and stale retries cannot overwrite later edits', async () => {
  const s = await setup(); await s.f.addParent(s.family.id);
  const input = { templateId: 'normal', name: '日常', rules: rules({ poetry: 1, word: 3 }), activate: true, baseRevision: 0, mutationId: 'save' };
  const results = await Promise.allSettled([s.call('saveDailyTemplate', input), s.call('saveDailyTemplate', { ...input, name: '另一个模板', mutationId: 'other', templateId: 'other' }, 'parent-b')]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'CONFLICT');
  const before = s.f.inspect(); assert.equal((await s.call('saveDailyTemplate', input)).duplicate, true); assert.deepEqual(s.f.inspect(), before);
  await assert.rejects(s.call('saveDailyTemplate', { ...input, name: 'different' }), { code: 'INVALID' });
  await s.command('saveDailyTemplate', { templateId: 'normal', name: '新配置', rules: rules({ word: 8 }), activate: true }, 'parent-b');
  const replay = await s.call('saveDailyTemplate', input); assert.equal(learning.activeTemplate(replay.family, s.childId).name, '新配置');
  assert.equal(replay.family.templateSets[s.childId].templates.filter(item => item.id === 'normal').length, 1);
  const second = (await s.call('addChild', { name: '小禾' })).family.children[1];
  await s.call('saveDailyTemplate', { ...input, childId: second.id, mutationId: 'other-child' });
  assert.equal(learning.activeTemplate(await s.fresh(), s.childId).rules.find(rule => rule.kind === 'word').quantity, 8);
});

test('old clients update the current named template and its revision, preserving a single configuration source', async () => {
  const s = await setup(); await s.day(today);
  await s.command('saveDailyTemplate', { templateId: 'normal', name: '日常', rules: rules({ word: 2 }), activate: true });
  const current = await s.day(today); await s.call('saveAutoPlans', { rules: rules({ poetry: 3, word: 9 }) });
  const family = await s.fresh(); const set = family.templateSets[s.childId]; assert.equal(set.revision, 2);
  assert.equal(learning.activeTemplate(family, s.childId).name, '日常'); assert.deepEqual(learning.activeTemplate(family, s.childId).rules, family.autoPlans[s.childId]);
  assert.deepEqual((await s.day(today)).tasks, current.tasks); assert.equal((await s.day(tomorrow)).tasks.filter(item => item.kind === 'word').length, 9);
});

test('templates validate quantities, names, membership and child visibility, and cap inactive templates without partial writes', async () => {
  const s = await setup(); const input = { templateId: 'one', name: '有效', rules: rules({ word: 1 }), activate: true, mutationId: 'valid', baseRevision: 0 };
  const before = s.f.inspect();
  for (const patch of [{ name: '' }, { name: '字'.repeat(25) }, { rules: [] }, { rules: rules({ word: 31 }) }, { activate: 'yes' }, { templateId: '../oops' }, { baseRevision: -1 }])
    await assert.rejects(s.call('saveDailyTemplate', { ...input, ...patch }), { code: 'INVALID' });
  await assert.rejects(s.call('saveDailyTemplate', input, 'stranger'), { code: 'FORBIDDEN' }); assert.deepEqual(s.f.inspect(), before);
  await s.call('saveDailyTemplate', input);
  await assert.rejects(s.command('saveDailyTemplate', { ...input, baseRevision: 1, mutationId: 'same-name', templateId: 'two', activate: false }), { code: 'INVALID' });
  const second = (await s.call('addChild', { name: '小禾' })).family.children[1];
  await s.command('saveDailyTemplate', { ...input, childId: second.id, mutationId: 'sibling' });
  const invitation = await s.call('createInvite', { role: 'child', guardianConsent: true }); await s.f.call('child', 'joinFamily', { code: invitation.code, memberName: '孩子' });
  for (const action of ['saveDailyTemplate', 'activateDailyTemplate', 'deleteDailyTemplate']) await assert.rejects(s.call(action, input, 'child'), { code: 'PARENT_REQUIRED' });
  const child = (await s.f.call('child', 'bootstrap', {})).family; assert.deepEqual(Object.keys(child.templateSets), [s.childId]);
  for (let i = 2; i <= 9; i++) await s.command('saveDailyTemplate', { ...input, templateId: 't'+i, name: '模板'+i, activate: false, mutationId: 'extra'+i, baseRevision: i-1 });
  const full = s.f.inspect();
  await assert.rejects(s.command('saveDailyTemplate', { ...input, templateId: 'over', name: '超额', activate: false, mutationId: 'over', baseRevision: 9 }), { code: 'LIMIT' });
  assert.deepEqual(s.f.inspect(), full);
});

function page(engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/plans/index'); delete require.cache[file]; require(file);
  const instance = { ...definition, engine, active: true, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  instance.unsubscribe = engine.subscribe(() => instance.render()); instance.render(); return instance;
}
const value = v => ({ detail: { value: v } });
test('template scope is editable without advanced settings and old-cloud shortages show their actual saved scope', async t => {
  const s = await setup(); const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast() {} };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  plans.openTemplate(); assert.equal(plans.data.templateAdvanced, false);
  const poetry = plans.data.rules.find(rule => rule.id === 'poetry');
  assert.equal(poetry.scope, 'starter');
  plans.changeScope({ currentTarget: { dataset: { id: 'poetry' } }, detail: { value: poetry.scopes.findIndex(scope => scope.id === 'shanghai54') } });
  assert.equal(plans.data.templateAdvanced, false);
  assert.equal(plans.data.rules.find(rule => rule.id === 'poetry').scope, 'shanghai54');
  assert.equal(plans.data.rules.find(rule => rule.id === 'poetry').quantity, poetry.quantity);
  assert.equal(plans.data.rules.find(rule => rule.id === 'poetry').mode, poetry.mode);
  const key = `${s.family.id}:${tomorrow}`;
  engine.state.days[key] = { ...engine.state.days[key],
    tasks: engine.state.days[key].tasks.filter(task => task.kind !== 'poetry'),
    generated: { [s.childId]: { poetry: { kind: 'poetry', scope: 'starter', mode: 'new', quantity: 2, actual: 0 } } },
    omitted: [{ childId: s.childId, kind: 'poetry', key: 'removed-poem', automatic: true }],
    warnings: [{ childId: s.childId, kind: 'poetry', message: '旧服务的缺额提示' }] };
  plans.render();
  assert.match(plans.data.dayWarnings[0].message, /亲子入门.*计划 1首.*已安排 0首/,
    'warnings explain the saved generated rule, not the unsaved broader draft');
  assert.equal(plans.data.rules.find(rule => rule.id === 'poetry').scope, 'shanghai54');
  const day = engine.state.days[key];
  day.generated[s.childId].poetry = { ...day.generated[s.childId].poetry, quantity: 3, actual: 2 };
  day.tasks.push(learning.taskFrom(learning.catalog.find(item => item.kind === 'poetry'), s.childId, 'a_remaining', 'new'));
  plans.render();
  assert.match(plans.data.dayWarnings[0].message, /计划 2首.*已安排 1首/,
    'deleting a task must not reuse the generated count from before deletion');
  day.omitted.push({ childId: s.childId, kind: 'poetry', key: 'another-removed-poem', automatic: true });
  plans.render(); assert.deepEqual(plans.data.dayWarnings, [], 'satisfied targets do not show stale shortage warnings');
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname, '../miniprogram/pages/plans/index.wxml'), 'utf8');
  const mainEditor = markup.split('<block wx:if="{{templateAdvanced}}">')[0];
  assert.match(mainEditor, /bindchange="changeScope"/); assert.match(mainEditor, /bindchange="changeMode"/);
});
test('template UI creates and enables a named draft, preserves unsaved input on refresh, detects conflicts and reloads only on request', async t => {
  const s = await setup(); await s.f.addParent(s.family.id); const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  const toasts = []; global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast: v => toasts.push(v.title) };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  plans.openTemplate(); plans.createTemplate(); plans.changeTemplateName(value('每日词句')); plans.updateRule('word', { quantity: 10 });
  plans.updateRule('poetry', { quantity: 2 }); plans.updateRule('english-reading', { quantity: 1 });
  const id = plans.data.templateId; await plans.refresh(); assert.equal(plans.data.templateName, '每日词句'); assert.equal(plans.data.templateId, id);
  await plans.saveAndUseTemplate(); assert.equal(plans.data.editor, 'preview'); assert.equal(plans.data.activeTemplateId, id); assert.equal(plans.data.draftDirty, false);
  assert.match(plans.data.activeTemplateSummary, /英语单词 10个/); assert.match(plans.data.activeTemplateSummary, /英文阅读 1篇/);
  plans.openTemplate(); plans.changeTemplateName(value('我的草稿'));
  await s.command('saveDailyTemplate', { templateId: id, name: '家人更新', rules: rules({ word: 5 }), activate: false }, 'parent-b');
  await plans.refresh(); assert.equal(plans.data.templateName, '我的草稿'); assert.equal(plans.data.templateConflict, true);
  await plans.saveTemplate(); assert.match(toasts.at(-1), /重新载入/);
  plans.resetRules(); assert.equal(plans.data.templateName, '家人更新'); assert.equal(plans.data.templateConflict, false);
  engine.state.family = { ...engine.state.family, id: 'different-family', templateSets: undefined, autoPlans: {} }; plans.render();
  assert.equal(plans.data.templateName, '每日积累'); assert.equal(plans.data.draftDirty, false);
});

test('lost template response can be retried with the same operation ID without duplicate templates', async t => {
  const s = await setup(); const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast() {} };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  plans.createTemplate(); plans.changeTemplateName(value('重试模板')); const templateId = plans.data.templateId;
  const original = engine.command.bind(engine); let mutation;
  engine.command = async (action, input) => { mutation = input.mutationId; await original(action, input); throw new Error('response lost'); };
  await plans.saveAndUseTemplate(); assert.equal(plans.data.templateConflict, false); assert.equal(plans.data.draftDirty, true);
  engine.command = async (action, input) => { assert.equal(input.mutationId, mutation); return original(action, input); };
  await plans.saveAndUseTemplate(); assert.equal(plans.data.draftDirty, false);
  assert.equal(learning.templateSet(await s.fresh(), s.childId).templates.filter(item => item.id === templateId).length, 1);
});

test('template responses preserve newer household fields and only recover the saved template when follow-up sync fails', async t => {
  const s = await setup(); const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast() {} };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  plans.createTemplate(); plans.changeTemplateName(value('日常'));
  const original = engine.command.bind(engine);
  engine.command = async (action, input) => {
    const result = await original(action, input);
    await s.call('addChild', { name: '小禾' }); await engine.sync();
    return result;
  };
  await plans.saveAndUseTemplate(); assert.equal(engine.state.family.children.length, 2, 'a newer household snapshot survives an older command response');
  plans.openTemplate(); plans.changeTemplateName(value('离线回执'));
  engine.sync = async () => {};
  engine.command = (action, input) => s.call(action, input);
  await plans.saveTemplate(); assert.equal(plans.data.activeTemplateName, '离线回执');
  assert.equal(engine.state.family.children.length, 2);
});

test('a late parent template response cannot restore parent data after the session changes to a child', async t => {
  const s = await setup(); await s.call('addChild', { name: '小禾' });
  const invitation = await s.call('createInvite', { role: 'child', guardianConsent: true });
  await s.f.call('child', 'joinFamily', { code: invitation.code, memberName: '孩子' });
  const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast() {} };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  plans.createTemplate(); plans.changeTemplateName(value('保存时切换'));
  engine.command = async (action, input) => {
    const result = await s.call(action, input);
    const child = await s.f.call('child', 'bootstrap', {});
    engine.save({ ...engine.state, family: child.family, userId: child.userId, days: {}, queue: [] });
    return result;
  };
  engine.sync = async () => {};
  await plans.saveAndUseTemplate(); assert.equal(engine.state.family.myRole, 'child');
  assert.equal(engine.state.family.children.length, 1); assert.equal(plans.data.isChild, true);
});

test('demo templates survive restart, drive automatic generation and leave completed days unchanged', async () => {
  const values = new Map(); const wx = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value) };
  const engine = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) }); await engine.sync();
  const childId = engine.state.family.children[0].id; const current = engine.viewDay(engine.today); const next = shiftDate(engine.today, 1);
  const input = { childId, templateId: 'normal', name: '日常', rules: rules({ word: 10, poetry: 2 }), activate: true, mutationId: 'demo', baseRevision: 0 };
  await engine.command('saveDailyTemplate', input); assert.deepEqual(engine.viewDay(engine.today).tasks, current.tasks);
  await engine.command('saveDailyTemplate', input);
  const reloaded = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) }); await reloaded.sync(next);
  assert.equal(learning.activeTemplate(reloaded.state.family, childId).name, '日常'); assert.equal(reloaded.viewDay(next).tasks.filter(task => task.kind === 'word').length, 10);
  await assert.rejects(reloaded.command('saveDailyTemplate', { ...input, name: '变更', mutationId: 'stale' }), { code: 'CONFLICT' });
  assert.equal(learning.activeTemplate(values.get('demo-backend-v1').family, childId).name, '日常');
});
