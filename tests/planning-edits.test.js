const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, memoryStorage } = require('./helpers');
const learning = require('../shared/learning');
const { dayKey } = require('../cloudfunctions/familyApi/service');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine, shiftDate } = require('../miniprogram/lib/sync-engine');
const today = '2026-10-12'; const tomorrow = '2026-10-13'; const later = '2026-10-14';
const event = id => ({ currentTarget: { dataset: { id } } });
const clone = value => structuredClone(value);
async function setup() {
  const f = fixture(); const family = await f.family(); const childId = family.children[0].id;
  const call = (action, input = {}, user = 'parent-a') => f.call(user, action, { familyId: family.id, childId, ...input });
  const day = async (date = tomorrow, user) => (await call('getDay', { date }, user)).day;
  let counter = 0;
  const edit = (view, task, targetDate) => ({ date: view.date, taskId: task.id, contentId: task.contentId, baseVersion: task.version,
    planRevision: view.planRevision || 0, mutationId: `edit_${++counter}`, ...(targetDate ? { targetDate } : {}) });
  const configure = values => call('saveAutoPlans', { rules: learning.emptyRules().map(rule => ({ ...rule, ...(values[rule.kind] || {}) })) });
  return { f, family, childId, call, day, edit, configure };
}
const ledgers = f => Object.fromEntries(Object.entries(f.inspect()).filter(([key]) => key.startsWith('learning/')));

test('delete an automatic preview slot without replacements, history writes, or changes to global quotas; retries and other phones agree', async () => {
  const s = await setup(); await s.f.addParent(s.family.id);
  await s.configure({ poetry: { quantity: 2 } });
  const view = await s.day(); const [removed, kept] = view.tasks;
  const before = ledgers(s.f); const input = s.edit(view, removed);
  const result = await s.call('editPlannedTask', input);
  assert.equal(result.duplicate, false); assert.deepEqual(ledgers(s.f), before);
  const second = await s.call('editPlannedTask', input); assert.equal(second.duplicate, true);
  const after = await s.day(tomorrow, 'parent-b'); assert.deepEqual(after.tasks.map(task => task.id), [kept.id]);
  assert.equal(after.warnings.length, 0, 'intentional removal is not a shortage');
  await assert.rejects(s.call('editPlannedTask', { ...input, targetDate: later }), { code: 'INVALID' });
  await assert.rejects(s.call('editPlannedTask', s.edit(view, kept), 'parent-b'), { code: 'CONFLICT' });
  assert.equal((await s.day(later)).tasks.length, 2, 'global quota stays unchanged');
  s.f.advance(86400000); assert.deepEqual((await s.day()).tasks, after.tasks, 'exclusion survives the date arriving');
});

test('move a manual library appointment atomically, merge destination duplicates and preserve completed/mastered history byte-for-byte', async () => {
  const s = await setup(); const current = await s.day(today); const completed = current.tasks[0];
  await s.call('setTaskDone', { date: today, taskId: completed.id, done: true, baseVersion: 0, mutationId: 'done' });
  await s.call('setMastery', { contentId: completed.contentId, mastered: true, baseVersion: 1 });
  await s.call('assignContent', { contentId: 'sh54-jiande', date: tomorrow });
  await s.call('assignContent', { contentId: 'sh54-jiande', date: later });
  const view = await s.day(); const task = view.tasks.find(item => item.contentId === 'sh54-jiande');
  const before = ledgers(s.f); const beforeToday = s.f.inspect()[`days/${dayKey(s.family.id, today)}`];
  const result = await s.call('editPlannedTask', s.edit(view, task, later));
  assert.equal(result.merged, true); assert.deepEqual(ledgers(s.f), before);
  assert.deepEqual(s.f.inspect()[`days/${dayKey(s.family.id, today)}`], beforeToday);
  assert.ok(!(await s.day()).tasks.some(item => item.contentId === task.contentId));
  const target = await s.day(later); assert.equal(target.tasks.filter(item => item.contentId === task.contentId).length, 1);
  const scheduled = s.f.inspect()[`families/${s.family.id}`].scheduledContents;
  assert.ok(!scheduled.some(item => item.date === tomorrow && item.contentId === task.contentId));
  assert.ok(scheduled.some(item => item.date === later && item.contentId === task.contentId));
  await s.call('editPlannedTask', s.edit(target, target.tasks.find(item => item.contentId === task.contentId)));
  assert.deepEqual(ledgers(s.f), before, 'deleting the moved assignment does not rewrite learning');
});

test('moving automatic content pins it to a later day, merges projected destination slot, and supports moving it back or into today', async () => {
  const s = await setup(); const view = await s.day(); const task = view.tasks.find(item => item.kind === 'poetry');
  const input = s.edit(view, task, later); await s.call('editPlannedTask', input);
  const target = await s.day(later); assert.equal(target.tasks.filter(item => item.kind === 'poetry').length, 1);
  assert.equal(target.tasks.find(item => item.kind === 'poetry').contentId, task.contentId);
  assert.equal((await s.day()).tasks.some(item => item.contentId === task.contentId), false);
  await s.call('editPlannedTask', s.edit(target, target.tasks.find(item => item.contentId === task.contentId), tomorrow));
  const movedBack = await s.day(); assert.equal(movedBack.tasks.filter(item => item.contentId === task.contentId).length, 1);
  const before = ledgers(s.f);
  await s.call('editPlannedTask', s.edit(movedBack, movedBack.tasks.find(item => item.contentId === task.contentId), today));
  assert.deepEqual(ledgers(s.f), before);
  assert.equal((await s.day(today)).tasks.filter(item => item.contentId === task.contentId).length, 1);
  assert.equal((await s.call('getHistory', { query: task.title })).total, 0);
});

test('delete once and daily plan occurrences without regenerating them; other days and recurring configuration remain intact', async () => {
  const s = await setup(); await s.configure({});
  for (const schedule of ['once', 'daily']) await s.call('addPlan', { title: schedule, kind: 'reading', subject: 'reading', minutes: 5, schedule, date: tomorrow });
  let view = await s.day(); await s.call('editPlannedTask', s.edit(view, view.tasks.find(task => task.title === 'once'), later));
  view = await s.day(); await s.call('editPlannedTask', s.edit(view, view.tasks.find(task => task.title === 'daily')));
  assert.equal((await s.day()).tasks.length, 0);
  assert.deepEqual((await s.day(later)).tasks.map(task => task.title).sort(), ['daily', 'once']);
  assert.ok(s.f.inspect()[`families/${s.family.id}`].plans.every(plan => plan.enabled));
});

test('simultaneous edits of one task cannot move it twice and explicit re-add survives an old response retry', async () => {
  const s = await setup(); await s.f.addParent(s.family.id);
  const view = await s.day(); const task = view.tasks[0]; const input = s.edit(view, task);
  const outcomes = await Promise.allSettled([s.call('editPlannedTask', input), s.call('editPlannedTask', s.edit(view, task, later), 'parent-b')]);
  assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].reason.code, 'CONFLICT');
  await s.call('assignContent', { contentId: task.contentId, date: tomorrow });
  await s.call('editPlannedTask', input);
  assert.equal((await s.day()).tasks.filter(item => item.contentId === task.contentId).length, 1, 'retry returns old receipt rather than deleting a re-added task');
  await assert.rejects(s.call('editPlannedTask', { ...input, mutationId: 'stale' }), { code: 'CONFLICT' });
});

test('a learned daily routine can be moved and remains intentional practice even after its recurring rule is paused', async () => {
  const s = await setup(); await s.configure({});
  await s.call('addPlan', { title: '朗读一遍', detail: '每天朗读', kind: 'reading', subject: 'reading', minutes: 5, schedule: 'daily', date: today });
  const current = await s.day(today); const task = current.tasks[0];
  await s.call('setTaskDone', { date: today, taskId: task.id, done: true, baseVersion: 0, mutationId: 'routine-done' });
  const view = await s.day(); const before = ledgers(s.f);
  await s.call('editPlannedTask', s.edit(view, view.tasks[0], later));
  await s.call('setPlanEnabled', { planId: task.id, enabled: false });
  const target = await s.day(later); assert.equal(target.tasks.length, 1); assert.equal(target.tasks[0].repeatAllowed, true);
  assert.deepEqual(ledgers(s.f), before); assert.equal((await s.day()).tasks.length, 0);
});

test('completion today removes the same work from future ordinary plans, rejects new library duplicates, but explicit review and daily routines survive', async () => {
  const s = await setup(); const current = await s.day(today); const task = current.tasks.find(item => item.kind === 'poetry');
  await s.call('assignContent', { contentId: task.contentId, date: tomorrow });
  await s.call('addPlan', { title: '固定读一遍', kind: 'reading', subject: 'reading', minutes: 5, schedule: 'daily', date: today });
  const repeated = (await s.day(today)).tasks.find(item => item.title === '固定读一遍');
  for (const item of [task, repeated]) await s.call('setTaskDone', { date: today, taskId: item.id, done: true, baseVersion: 0, mutationId: item.id });
  const snapshot = clone(ledgers(s.f)); const view = await s.day();
  assert.ok(!view.tasks.some(item => item.contentId === task.contentId));
  assert.ok(view.tasks.some(item => item.title === repeated.title));
  assert.deepEqual(ledgers(s.f), snapshot);
  await assert.rejects(s.call('assignContent', { contentId: task.contentId, date: later }), { code: 'ALREADY_LEARNED' });
  await assert.rejects(s.call('addPlan', { title: task.title, detail: task.detail, kind: task.kind, subject: task.subject, minutes: task.minutes, schedule: 'once', date: later }), { code: 'ALREADY_LEARNED' });
  await s.configure({ poetry: { quantity: 2, mode: 'review' } });
  assert.ok((await s.day()).tasks.some(item => item.contentId === task.contentId && item.mode === 'review'));
  s.f.advance(86400000); assert.equal((await s.day()).tasks.filter(item => item.contentId === task.contentId).length, 1);
});

test('dedup uses catalogue work identity and exact custom content, preserves custom variations, children, case and all completed snapshots', async () => {
  const pair = learning.catalog.find(a => a.workId && learning.catalog.some(b => b.id !== a.id && (b.workId || b.id) === a.workId));
  const other = learning.catalog.find(a => a.id !== pair.id && (a.workId || a.id) === pair.workId);
  const s = await setup(); await s.configure({});
  await s.call('assignContent', { contentId: pair.id, date: tomorrow }); await s.call('assignContent', { contentId: other.id, date: tomorrow });
  for (const detail of ['same body', 'same body', 'different body']) await s.call('addPlan', { title: pair.title, detail, kind: pair.kind, subject: 'poetry', minutes: 5, schedule: 'once', date: tomorrow });
  const view = await s.day(); assert.equal(view.tasks.length, 3);
  assert.equal(new Set(view.tasks.map(learning.planningKey)).size, 3);
  assert.notEqual(learning.planningKey({ id: 'x', kind: 'word', title: 'May', detail: '' }), learning.planningKey({ id: 'y', kind: 'word', title: 'may', detail: '' }));
  const records = { a: { records: {} }, b: { records: {} } };
  const first = { ...learning.taskFrom(pair, 'a', 'one', 'manual'), done: true };
  const second = { ...learning.taskFrom(other, 'a', 'two', 'manual'), done: true };
  const third = learning.taskFrom(pair, 'b', 'three', 'manual');
  const day = { date: tomorrow, tasks: [first, second, third, learning.taskFrom(pair, 'a', 'four', 'manual')] };
  learning.generateDay({ children: [{ id: 'a' }, { id: 'b' }], plans: [] }, day, records, true);
  assert.deepEqual(day.tasks, [first, second, third]);
  assert.deepEqual(records.a.records[pair.id].completedDates, [tomorrow]);
  assert.deepEqual(records.a.records[other.id].completedDates, [tomorrow]);
});

test('planning edits enforce membership, parent role, dates, task identity/version and preserve today and historical completions', async () => {
  const s = await setup(); const current = await s.day(today); const task = current.tasks[0];
  await s.call('setTaskDone', { date: today, taskId: task.id, done: true, baseVersion: 0, mutationId: 'done' });
  const view = await s.day(); const input = s.edit(view, view.tasks[0]);
  const before = s.f.inspect();
  for (const date of [today, '2026-10-11', '2026-02-30', '2027-10-13']) await assert.rejects(s.call('editPlannedTask', { ...input, date }), { code: 'INVALID' });
  for (const targetDate of [tomorrow, '2026-10-11', '2027-02-29', '2027-10-13', null, '']) await assert.rejects(s.call('editPlannedTask', { ...input, targetDate }), { code: 'INVALID' });
  await assert.rejects(s.call('editPlannedTask', { ...input, baseVersion: 10 }), { code: 'CONFLICT' });
  await assert.rejects(s.call('editPlannedTask', { ...input, contentId: 'unrelated' }), { code: 'CONFLICT' });
  await assert.rejects(s.call('editPlannedTask', input, 'outsider'), { code: 'FORBIDDEN' });
  assert.deepEqual(s.f.inspect(), before);
  const invite = await s.call('createInvite', { role: 'child', guardianConsent: true }); await s.f.call('child', 'joinFamily', { code: invite.code, memberName: '孩子' });
  await assert.rejects(s.call('editPlannedTask', input, 'child'), { code: 'PARENT_REQUIRED' });
  await s.call('editPlannedTask', input);
  const visible = await s.day(tomorrow, 'child'); assert.ok(visible.omitted.every(item => item.childId === s.childId));
});

function page(engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/plans/index'); delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, data: clone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}
test('page adjusts dates, deletes only the selected task, retains request IDs for retries and closes on household, child or date change', async t => {
  const s = await setup(); const { engine } = s.f.client('parent-a'); await engine.sync(tomorrow);
  global.getApp = () => ({ engine, mode: 'cloud', navigation: {} }); const toasts = [];
  global.wx = { showToast: value => toasts.push(value.title) };
  t.after(() => { delete global.Page; delete global.wx; delete global.getApp; });
  const plans = page(engine); plans.unsubscribe = engine.subscribe(() => plans.render()); t.after(() => plans.cleanup()); plans.render(); let task = plans.data.tasks[0];
  plans.editTask(event(task.id)); assert.equal(plans.data.editTarget.taskId, task.id);
  await plans.saveTaskDate(); assert.equal(toasts.at(-1), '请选择不同的学习日期');
  plans.changeEditDate({ detail: { value: later } }); await plans.saveTaskDate();
  assert.equal(plans.data.editTarget, null); assert.ok(!(await s.day()).tasks.some(item => item.id === task.id));
  task = plans.data.tasks[0]; plans.editTask(event(task.id));
  const command = engine.command.bind(engine); let firstId;
  engine.command = async (action, input) => { firstId = input.mutationId; await command(action, input); throw new Error('response lost'); };
  await plans.deleteTask(); assert.ok(plans.data.editTarget); assert.match(toasts.at(-1), /response lost/);
  engine.command = async (action, input) => { assert.equal(input.mutationId, firstId); return command(action, input); };
  await plans.deleteTask(); assert.equal(plans.data.editTarget, null); assert.equal((await s.day()).tasks.length, 0);
  engine.command = command; await s.call('assignContent', { contentId: 'sh54-jiande', date: tomorrow }); await plans.refresh();
  plans.editTask(event(plans.data.tasks[0].id));
  const view = await s.day(); await s.call('editPlannedTask', s.edit(view, view.tasks[0], later));
  await plans.deleteTask(); assert.equal(plans.data.editTarget, null); assert.match(toasts.at(-1), /家人已调整/);
  await s.call('assignContent', { contentId: 'sh54-jiande', date: tomorrow }); await plans.refresh();
  plans.editTask(event(plans.data.tasks[0].id)); engine.state.family = { ...engine.state.family, id: 'changed' }; plans.render(); assert.equal(plans.data.editTarget, null);
  await engine.sync(tomorrow); plans.render(); plans.editTask(event(plans.data.tasks[0].id)); plans.onHide(); assert.equal(plans.data.editTarget, null);
});

test('demo edits persist deletion and rescheduling across reloads and share learned-content filtering', async () => {
  const data = new Map(); const wx = { getStorageSync: key => clone(data.get(key)), setStorageSync: (key, value) => data.set(key, clone(value)) };
  const engine = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) }); await engine.sync();
  const next = shiftDate(engine.today, 1); const after = shiftDate(engine.today, 2); await engine.sync(next);
  let view = engine.viewDay(next); const task = view.tasks[0];
  const payload = { date: next, taskId: task.id, contentId: task.contentId, baseVersion: task.version, planRevision: view.planRevision || 0, mutationId: 'demo-move', targetDate: after };
  await engine.command('editPlannedTask', payload); await engine.sync(next); assert.ok(!engine.viewDay(next).tasks.some(item => item.contentId === task.contentId));
  const reloaded = new SyncEngine({ storage: memoryStorage(), transport: createDemo(wx) }); await reloaded.sync(after);
  view = reloaded.viewDay(after); const moved = view.tasks.find(item => item.contentId === task.contentId);
  await reloaded.command('editPlannedTask', { ...payload, date: after, baseVersion: moved.version, taskId: moved.id, targetDate: undefined, planRevision: view.planRevision, mutationId: 'demo-delete' });
  await reloaded.sync(after); assert.ok(!reloaded.viewDay(after).tasks.some(item => item.contentId === task.contentId));
});
