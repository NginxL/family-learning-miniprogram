const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { fixture, memoryStorage } = require('./helpers');
const learning = require('../shared/learning');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine, shiftDate } = require('../miniprogram/lib/sync-engine');
const rules = counts => learning.emptyRules().map(rule => ({ ...rule, quantity: counts[rule.kind] || 0 }));
const weekly = { weekdaysTemplateId: 'school', weekendTemplateId: 'weekend' };
const records = f => Object.fromEntries(Object.entries(f.inspect()).filter(([key]) => key.startsWith('learning/')));

async function setup() {
  const f = fixture(); const family = await f.family(); const childId = family.children[0].id; let id = 0;
  const call = (action, input = {}, user = 'parent-a') => f.call(user, action, { familyId: family.id, childId, ...input });
  const fresh = async () => (await f.call('parent-a', 'bootstrap', {})).family;
  const command = async (action, values = {}, user = 'parent-a') => call(action, {
    baseRevision: learning.templateSet(await fresh(), values.childId || childId).revision, mutationId: `week_${++id}`, ...values
  }, user);
  const day = async date => (await call('getDay', { date })).day;
  await day('2026-10-12');
  await command('saveDailyTemplate', { templateId: 'school', name: '上学日', rules: rules({ word: 2 }), activate: true });
  await command('saveDailyTemplate', { templateId: 'weekend', name: '周末', rules: rules({ poetry: 2, sentence: 1 }), activate: false });
  const schedule = (weeklySchedule = weekly, extra = {}) => command('saveTemplateSchedule', { activeId: 'school', weeklySchedule, ...extra });
  return { f, family, childId, call, fresh, command, day, schedule };
}

test('weekly templates resolve by the target Shanghai date, including Friday/weekend/Monday and month/year boundaries', async () => {
  const s = await setup(); const beforeToday = await s.day('2026-10-12'); await s.schedule(); const before = records(s.f);
  for (const [date, weekend] of [['2026-10-16', false], ['2026-10-17', true], ['2026-10-18', true], ['2026-10-19', false], ['2026-11-01', true], ['2027-01-01', false], ['2027-01-02', true]]) {
    const day = await s.day(date);
    assert.equal(day.tasks.filter(task => task.kind === 'word').length, weekend ? 0 : 2, date);
    assert.equal(day.tasks.filter(task => task.kind === 'poetry').length, weekend ? 2 : 0, date);
  }
  assert.deepEqual(records(s.f), before, 'preview dates never become learning history');
  assert.deepEqual((await s.day('2026-10-12')).tasks, beforeToday.tasks);
  s.f.advance(4 * 86400000 + 14 * 3600000); // Saturday 00:00 in Shanghai, still Friday UTC.
  const firstSaturday = await s.day('2026-10-17'); assert.equal(firstSaturday.tasks.filter(task => task.kind === 'poetry').length, 2);
  await s.command('saveDailyTemplate', { templateId: 'weekend', name: '周末轻松', rules: rules({ poetry: 1 }), activate: false });
  assert.deepEqual((await s.day('2026-10-17')).tasks, firstSaturday.tasks);
  assert.equal((await s.day('2026-10-18')).tasks.filter(task => task.kind === 'poetry').length, 1);
});

test('weekday selection is independent of the device timezone', () => {
  const script = `const l=require('./shared/learning'); const f={children:[{id:'c'}],plans:[],templateSets:{c:{templates:[{id:'a',name:'weekday',rules:[]},{id:'b',name:'weekend',rules:[]}],activeId:'a',revision:1,weeklySchedule:{weekdaysTemplateId:'a',weekendTemplateId:'b'}}}}; console.log(JSON.stringify(['2026-10-16','2026-10-17','2026-10-18','2026-10-19'].map(d=>l.templateForDate(f,'c',d).id)));`;
  for (const TZ of ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati'])
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ } }).toString()), ['a', 'b', 'b', 'a']);
});

test('switching weekly assignments preserves one-off exclusions, manual dates, completed history and mastery', async () => {
  const s = await setup(); const today = await s.day('2026-10-12'); const done = today.tasks[0];
  await s.call('setTaskDone', { date: today.date, taskId: done.id, done: true, baseVersion: 0, mutationId: 'done' });
  await s.call('setMastery', { contentId: done.contentId, mastered: true, baseVersion: 1 });
  const ledger = records(s.f); const snapshot = (await s.day(today.date)).tasks;
  await s.schedule(); const saturday = await s.day('2026-10-17'); const removed = saturday.tasks.find(task => task.kind === 'poetry');
  await s.call('editPlannedTask', { date: saturday.date, taskId: removed.id, contentId: removed.contentId, baseVersion: 0, planRevision: 0, mutationId: 'omit' });
  await s.call('assignContent', { date: saturday.date, contentId: 'sh54-jiande' });
  await s.schedule({ weekdaysTemplateId: 'school', weekendTemplateId: 'school' });
  assert.equal((await s.day(saturday.date)).tasks.filter(task => task.kind === 'word').length, 2);
  await s.schedule(); const restored = await s.day(saturday.date);
  assert.ok(!restored.tasks.some(task => task.id === removed.id));
  assert.equal(restored.tasks.filter(task => task.kind === 'poetry' && task.mode !== 'manual').length, 1);
  assert.ok(restored.tasks.some(task => task.contentId === 'sh54-jiande'));
  assert.deepEqual(records(s.f), ledger); assert.deepEqual((await s.day(today.date)).tasks, snapshot);
});

test('weekly assignments keep template references through edits and prevent deleting referenced templates; disabling restores daily mode', async () => {
  const s = await setup(); await s.schedule();
  const before = s.f.inspect(); await assert.rejects(s.command('deleteDailyTemplate', { templateId: 'weekend' }), { code: 'INVALID' });
  assert.deepEqual(s.f.inspect(), before);
  await s.command('saveDailyTemplate', { templateId: 'weekend', name: '周末练习', rules: rules({ word: 6 }), activate: false });
  assert.equal(learning.templateForDate(await s.fresh(), s.childId, '2026-10-17').name, '周末练习');
  assert.equal((await s.day('2026-10-17')).tasks.filter(task => task.kind === 'word').length, 6);
  await s.schedule(null); await s.command('deleteDailyTemplate', { templateId: 'weekend' });
  assert.equal((await s.day('2026-10-17')).tasks.filter(task => task.kind === 'word').length, 2);
  assert.equal(learning.templateSet(await s.fresh(), s.childId).weeklySchedule, undefined);
});

test('schedule and template edits share a revision; retries retain their identity without replacing newer assignments', async () => {
  const s = await setup(); await s.f.addParent(s.family.id);
  const input = { activeId: 'school', weeklySchedule: weekly, baseRevision: 2, mutationId: 'schedule' };
  const concurrent = await Promise.allSettled([s.call('saveTemplateSchedule', input), s.call('saveDailyTemplate', {
    templateId: 'weekend', name: '另一个名称', rules: rules({ poetry: 1 }), activate: false, baseRevision: 2, mutationId: 'other'
  }, 'parent-b')]);
  assert.equal(concurrent[0].status, 'fulfilled'); assert.equal(concurrent[1].reason.code, 'CONFLICT');
  const before = s.f.inspect(); assert.equal((await s.call('saveTemplateSchedule', input)).duplicate, true); assert.deepEqual(s.f.inspect(), before);
  await assert.rejects(s.call('saveTemplateSchedule', { ...input, weeklySchedule: null }), { code: 'INVALID' });
  await s.schedule(null);
  const replay = await s.call('saveTemplateSchedule', input);
  assert.equal(replay.family.templateSets[s.childId].weeklySchedule, undefined);
});

test('schedule payloads and ownership are validated, children cannot edit, and legacy writes preserve weekly settings', async () => {
  const s = await setup(); const input = { activeId: 'school', weeklySchedule: weekly, baseRevision: 2, mutationId: 'safe' };
  const before = s.f.inspect();
  for (const patch of [{ weeklySchedule: undefined }, { weeklySchedule: {} }, { weeklySchedule: [] }, { weeklySchedule: { ...weekly, weekendTemplateId: 'missing' } }, { activeId: 'missing' }, { baseRevision: -1 }])
    await assert.rejects(s.call('saveTemplateSchedule', { ...input, ...patch }), { code: 'INVALID' });
  await assert.rejects(s.call('saveTemplateSchedule', input, 'outsider'), { code: 'FORBIDDEN' }); assert.deepEqual(s.f.inspect(), before);
  const other = (await s.call('addChild', { name: '小禾' })).family.children[1];
  await s.command('saveDailyTemplate', { childId: other.id, templateId: 'sibling-only', name: '另一个孩子', rules: rules({ word: 9 }), activate: true });
  await assert.rejects(s.call('saveTemplateSchedule', { ...input, weeklySchedule: { ...weekly, weekendTemplateId: 'sibling-only' } }), { code: 'INVALID' });
  await s.schedule();
  const invite = await s.call('createInvite', { role: 'child', guardianConsent: true });
  await s.f.call('child', 'joinFamily', { code: invite.code, memberName: '孩子' });
  await assert.rejects(s.call('saveTemplateSchedule', input, 'child'), { code: 'PARENT_REQUIRED' });
  const child = (await s.f.call('child', 'bootstrap', {})).family;
  assert.deepEqual(Object.keys(child.templateSets), [s.childId]); assert.deepEqual(child.templateSets[s.childId].weeklySchedule, weekly);
  await s.call('saveAutoPlans', { rules: rules({ word: 5 }) });
  assert.deepEqual(learning.templateSet(await s.fresh(), s.childId).weeklySchedule, weekly);
  const friday = await s.day('2026-10-16');
  assert.equal(friday.tasks.filter(task => task.childId === s.childId && task.kind === 'word').length, 5);
  assert.equal(friday.tasks.filter(task => task.childId === other.id && task.kind === 'word').length, 9);
  assert.equal((await s.day('2026-10-17')).tasks.filter(task => task.kind === 'poetry').length, 2);
});

function page(engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/plans/index'); delete require.cache[file]; require(file);
  const instance = { ...definition, engine, active: true, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  instance.unsubscribe = engine.subscribe(() => instance.render()); instance.render(); return instance;
}
const event = value => ({ detail: { value } });
async function ui(t) {
  const s = await setup(); s.f.advance(4 * 86400000); const { engine } = s.f.client('parent-a'); await engine.sync('2026-10-17');
  const toasts = []; global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); global.wx = { showToast: v => toasts.push(v.title) };
  const plans = page(engine); t.after(() => { plans.cleanup(); delete global.Page; delete global.wx; delete global.getApp; });
  return { ...s, engine, plans, toasts };
}
test('compact plans expose all tomorrow tasks, keep advanced choices, and configure weekdays/weekends in a short dialog', async t => {
  const s = await ui(t); const p = s.plans;
  p.setData({ subjectFilter: 'poetry' }); p.render(); assert.equal(p.data.subjectFilter, 'all');
  assert.equal(p.data.templateAdvanced, false); p.toggleTemplateAdvanced();
  p.updateRule('word', { scope: 'foundation' }); p.toggleTemplateAdvanced(); assert.equal(p.data.rules.find(r => r.id === 'word').scope, 'foundation');
  p.openSchedule(); assert.equal(p.data.scheduleDraft, null, 'unsaved template changes stay intact');
  p.resetRules(); p.openSchedule(); p.changeWeekly(event(true));
  assert.deepEqual(p.data.scheduleRows.map(r => r.label), ['周一至周五', '周六、周日']);
  p.chooseScheduleTemplate({ detail: { value: p.data.templates.findIndex(item => item.id === 'weekend') }, currentTarget: { dataset: { slot: 'weekendTemplateId' } } });
  await p.saveSchedule(); assert.equal(p.data.scheduleDraft, null); assert.equal(p.data.previewTemplateName, '周末'); assert.equal(p.data.weekdayLabel, '周六');
  assert.equal(p.data.tasks.filter(task => task.kind === 'poetry').length, 2);
  p.openSchedule(); p.changeWeekly(event(false)); assert.equal(p.data.scheduleRows.length, 1); await p.saveSchedule();
  assert.equal(p.data.weeklyEnabled, false); assert.equal(p.data.previewTemplateName, '上学日');
});

test('schedule dialog keeps a conflicting draft until reloaded and safely retries a lost successful response', async t => {
  const s = await ui(t); const p = s.plans; p.openSchedule(); p.changeWeekly(event(true));
  p.chooseScheduleTemplate({ detail: { value: p.data.templates.findIndex(item => item.id === 'weekend') }, currentTarget: { dataset: { slot: 'weekendTemplateId' } } });
  await s.schedule(null); await p.refresh(); assert.equal(p.data.scheduleConflict, true); assert.equal(p.data.scheduleDraft.weekly, true);
  await p.saveSchedule(); assert.match(s.toasts.at(-1), /重新载入/);
  p.openSchedule(); assert.equal(p.data.scheduleConflict, false); p.changeWeekly(event(true));
  const original = s.engine.command.bind(s.engine); let mutation;
  s.engine.command = async (action, input) => { mutation = input.mutationId; await original(action, input); throw new Error('response lost'); };
  await p.saveSchedule(); assert.equal(p.data.scheduleConflict, false); assert.ok(p.data.scheduleDraft);
  s.engine.command = (action, input) => { assert.equal(input.mutationId, mutation); return original(action, input); };
  await p.saveSchedule(); assert.equal(p.data.scheduleDraft, null); assert.equal(p.data.weeklyEnabled, true);
});

test('late schedule responses cannot restore parent data after identity/role changes', async t => {
  const s = await ui(t); const p = s.plans;
  await s.call('addChild', { name: '小禾' }); const invite = await s.call('createInvite', { role: 'child', guardianConsent: true });
  await s.f.call('child', 'joinFamily', { code: invite.code, memberName: '孩子' });
  p.openSchedule(); p.changeWeekly(event(true));
  s.engine.command = async (action, input) => {
    const result = await s.call(action, input); const next = await s.f.call('child', 'bootstrap', {});
    s.engine.save({ ...s.engine.state, userId: next.userId, family: next.family, days: {}, queue: [] }); return result;
  };
  s.engine.sync = async () => {};
  await p.saveSchedule(); assert.equal(s.engine.state.family.myRole, 'child'); assert.equal(s.engine.state.family.children.length, 1); assert.equal(p.data.scheduleDraft, null);
  p.openSchedule(); assert.equal(p.data.scheduleDraft, null);
});

test('demo schedules survive restart and use target-date rules while legacy daily state remains compatible', async () => {
  const values = new Map(); const wx = { getStorageSync: k => values.get(k), setStorageSync: (k, v) => values.set(k, v) };
  const engine = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) }); await engine.sync(); const childId = engine.state.family.children[0].id;
  const defaults = learning.templateSet(engine.state.family, childId); const activeId = defaults.activeId;
  await engine.command('saveDailyTemplate', { childId, templateId: 'weekend', name: '周末', rules: rules({ word: 4 }), activate: false, baseRevision: 0, mutationId: 'create' });
  const input = { childId, activeId, weeklySchedule: { weekdaysTemplateId: activeId, weekendTemplateId: 'weekend' }, baseRevision: 1, mutationId: 'schedule' };
  await engine.command('saveTemplateSchedule', input); await engine.command('saveTemplateSchedule', input);
  const restarted = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) });
  let saturday = shiftDate(engine.today, 1); while (new Date(saturday+'T00:00:00Z').getUTCDay() !== 6) saturday = shiftDate(saturday, 1);
  await restarted.sync(saturday); assert.equal(restarted.viewDay(saturday).tasks.filter(task => task.kind === 'word').length, 4);
  assert.deepEqual(learning.templateSet(restarted.state.family, childId).weeklySchedule, input.weeklySchedule);
  await assert.rejects(restarted.command('deleteDailyTemplate', { childId, templateId: 'weekend', baseRevision: 2, mutationId: 'delete' }), /星期安排/);
});
