const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const { fixture, memoryStorage } = require('./helpers');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { createDemo } = require('../miniprogram/lib/demo');
const date = '2026-10-12';

test('library status covers more than one history page, counts completed days, and excludes plans and undone work', () => {
  const ledger = { records: {} };
  const tasks = learning.catalog.filter(item => item.kind === 'word').slice(0, 51).map((item, i) => ({
    ...learning.taskFrom(item, 'child', `task-${i}`, 'new'), done: i > 0
  }));
  learning.recordTasks(ledger, tasks, date);
  learning.recordTasks(ledger, [tasks[1]], '2026-10-13');
  ledger.records[tasks[1].contentId].mastered = true;
  assert.equal(learning.history(ledger).items.length, 30);
  const status = learning.learningStatus(ledger);
  assert.equal(status.items.length, 50);
  assert.ok(!status.items.some(item => item.contentId === tasks[0].contentId));
  assert.deepEqual(status.items.find(item => item.contentId === tasks[1].contentId), {
    contentId: tasks[1].contentId, learnedCount: 2, lastLearned: '2026-10-13', mastered: true
  });
  assert.ok(status.items.every(item => !('detail' in item) && !('title' in item)));
  tasks[2].done = false; learning.recordTasks(ledger, tasks, date);
  assert.ok(!learning.learningStatus(ledger).items.some(item => item.contentId === tasks[2].contentId));
});

test('two devices refresh confirmed learning and mastery, offline uses isolated cache, undo removes the badge', async () => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, scope = { familyId: family.id, childId };
  const a = f.client('parent-a'), b = f.client('parent-b');
  await a.engine.sync(date); await b.engine.sync(date);
  assert.deepEqual((await b.engine.getLearningStatus({ childId })).items, []);
  const task = a.engine.viewDay(date).tasks[0];
  a.engine.enqueue(date, task.id, true); await a.engine.sync(date);
  const history = await a.engine.getHistory({ childId });
  await f.call('parent-a', 'setMastery', { ...scope, contentId: task.contentId, baseVersion: history.items[0].version, mastered: true });
  assert.equal((await b.engine.getLearningStatus({ childId })).items[0].mastered, true);
  b.offline(); const cached = await b.engine.getLearningStatus({ childId });
  assert.equal(cached.cached, true); assert.equal(cached.items[0].contentId, task.contentId);
  await assert.rejects(b.engine.getLearningStatus({ childId: 'uncached-child' }));
  a.engine.enqueue(date, task.id, false); await a.engine.sync(date);
  b.online(); assert.deepEqual((await b.engine.getLearningStatus({ childId })).items, []);
  const raw = b.storage.read(); delete raw.learningStatuses;
  const legacy = memoryStorage(); legacy.write(raw);
  const restored = f.client('parent-b', legacy); assert.deepEqual((await restored.engine.getLearningStatus({ childId })).items, []);
});

test('learning status respects membership and child binding; role changes discard caches and late responses', async () => {
  const f = fixture(), family = await f.family(); const childId = family.children[0].id;
  const scope = { familyId: family.id, childId };
  const added = await f.call('parent-a', 'addChild', { familyId: family.id, name: '另一个孩子' });
  const sibling = added.family.children[1].id;
  const invite = await f.call('parent-a', 'createInvite', { ...scope, role: 'child', guardianConsent: true });
  await f.call('child-a', 'joinFamily', { code: invite.code, memberName: '孩子' });
  assert.deepEqual((await f.call('child-a', 'getLearningStatus', scope)).items, []);
  await assert.rejects(f.call('child-a', 'getLearningStatus', { ...scope, childId: sibling }), e => e.code === 'FORBIDDEN');
  await assert.rejects(f.call('outsider', 'getLearningStatus', scope), e => e.code === 'FORBIDDEN');
  const a = f.client('parent-a'); await a.engine.sync(date); await a.engine.getLearningStatus({ childId });
  let resolve;
  const engine = new SyncEngine({ storage: a.storage, transport: async action => {
    if (action === 'getLearningStatus') return new Promise(r => { resolve = r; });
    return { userId: engine.state.userId, today: date, family: { ...engine.state.family, myRole: 'child', myChildId: childId } };
  }});
  const stale = engine.getLearningStatus({ childId: sibling });
  await engine.bootstrap(); assert.deepEqual(engine.state.learningStatuses, {});
  resolve({ items: [{ contentId: 'private-sibling', learnedCount: 1, lastLearned: date, mastered: false }] });
  await assert.rejects(stale, /身份已切换/); assert.deepEqual(engine.state.learningStatuses, {});
});

function libraryPage(t, engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index'); delete require.cache[file]; require(file);
  t.after(() => { delete global.Page; });
  return { ...definition, engine, active: true, data: { ...structuredClone(definition.data), today: date, childId: 'a', family: { id: 'family' } },
    setData(patch) { Object.assign(this.data, patch); } };
}

test('library marks and filters learned content; a late response cannot restore the previous child status', async t => {
  const pending = [];
  const page = libraryPage(t, { snapshot: () => ({ today: date, family: { id: 'family', myRole: 'owner', children: [] } }),
    viewDay: () => ({ tasks: [] }), getLearningStatus: ({ childId }) => new Promise(resolve => pending.push({ childId, resolve })) });
  page.afterRender(); const first = pending[0];
  page.setData({ childId: 'b' }); page.afterRender();
  const id = learning.catalog[0].id;
  pending[1].resolve({ items: [{ contentId: id, learnedCount: 2, lastLearned: date, mastered: true }], cached: false });
  await new Promise(setImmediate);
  assert.equal(page.data.items.find(item => item.id === id).learnedLabel, '已掌握');
  first.resolve({ items: [], cached: false }); await new Promise(setImmediate);
  assert.equal(page.data.items.find(item => item.id === id).learnedCount, 2);
  page.changeLearningFilter({ detail: { value: 2 } }); assert.equal(page.data.total, 1);
  page.changeLearningFilter({ detail: { value: 1 } }); assert.ok(page.data.items.every(item => !item.learnedLabel));
  page.setData({ childId: 'c' }); page.afterRender();
  assert.equal(page.data.learningReady, false); assert.ok(page.data.items.every(item => !item.learnedLabel));
  page.active = false; page.cleanup(); pending[2].resolve({ items: [{ contentId: id, learnedCount: 1, lastLearned: date, mastered: false }], cached: true });
  await new Promise(setImmediate); assert.equal(page.data.learningReady, false);
});

test('demo retains confirmed learning status after restart', async () => {
  const storage = new Map(), wx = { getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,value) };
  let demo = createDemo(wx); const boot = await demo('bootstrap', { ensureDefault: true }); const childId = boot.family.children[0].id;
  const day = (await demo('getDay', { date: boot.today })).day; const task = day.tasks[0];
  await demo('setTaskDone', { date: boot.today, taskId: task.id, baseVersion: task.version, done: true });
  demo = createDemo(wx); const status = await demo('getLearningStatus', { childId });
  assert.equal(status.items[0].contentId, task.contentId); assert.equal(status.items[0].learnedCount, 1);
});
