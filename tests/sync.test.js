const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { memoryStorage } = require('./helpers');
const DATE = '2026-10-12';

test('two independently cached clients see a shared check-in after sync', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const a = f.client('parent-a'); const b = f.client('parent-b');
  await a.engine.sync(DATE); await b.engine.sync(DATE);
  const taskId = a.engine.viewDay(DATE).tasks[0].id;
  a.engine.enqueue(DATE, taskId, true);
  await a.engine.sync(DATE); await b.engine.sync(DATE);
  assert.equal(b.engine.viewDay(DATE).tasks[0].done, true);
  assert.equal(a.engine.state.queue.length, 0);
});

test('offline check-in persists across restart and is uploaded when connection returns', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a');
  await a.engine.sync(DATE); a.offline();
  a.engine.enqueue(DATE, a.engine.viewDay(DATE).tasks[0].id, true);
  await a.engine.sync(DATE);
  assert.equal(a.engine.status, 'offline');
  const restarted = f.client('parent-a', a.storage);
  assert.equal(restarted.engine.viewDay(DATE).tasks[0].pending, true);
  await restarted.engine.sync(DATE);
  assert.equal(restarted.engine.viewDay(DATE).tasks[0].done, true);
  assert.equal(restarted.engine.state.queue.length, 0);
});

test('successful server write with lost response retries without a duplicate version', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a');
  await a.engine.sync(DATE);
  a.engine.enqueue(DATE, a.engine.viewDay(DATE).tasks[0].id, true);
  a.loseNextResponse(); await a.engine.sync(DATE);
  assert.equal(a.engine.state.queue.length, 1);
  await a.engine.sync(DATE);
  assert.equal(a.engine.state.queue.length, 0);
  assert.equal(a.engine.viewDay(DATE).tasks[0].version, 1);
});

test('offline done/undo sequence preserves order', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a'); await a.engine.sync(DATE);
  const taskId = a.engine.viewDay(DATE).tasks[0].id;
  a.engine.enqueue(DATE, taskId, true); a.engine.enqueue(DATE, taskId, false);
  await a.engine.sync(DATE);
  const task = a.engine.viewDay(DATE).tasks[0];
  assert.equal(task.done, false); assert.equal(task.version, 2);
});

test('conflicting offline changes preserve server state and notify the user', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const a = f.client('parent-a'); const b = f.client('parent-b');
  await a.engine.sync(DATE); await b.engine.sync(DATE);
  const taskId = a.engine.viewDay(DATE).tasks[0].id;
  b.engine.enqueue(DATE, taskId, true); b.engine.enqueue(DATE, taskId, false);
  a.engine.enqueue(DATE, taskId, true); await a.engine.sync(DATE); await b.engine.sync(DATE);
  assert.equal(b.engine.viewDay(DATE).tasks[0].done, true);
  assert.equal(b.engine.state.queue.length, 0);
  assert.match(b.engine.state.notice, /已被家人更新/);
});

test('revoked membership clears cached household and queued writes', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const b = f.client('parent-b'); await b.engine.sync(DATE);
  b.engine.enqueue(DATE, b.engine.viewDay(DATE).tasks[0].id, true);
  await f.call('parent-a', 'removeMember', { familyId: family.id, memberId: b.engine.state.userId });
  await b.engine.sync(DATE);
  assert.equal(b.engine.state.family, null); assert.deepEqual(b.engine.state.days, {}); assert.equal(b.engine.state.queue.length, 0);
});

test('account switch cannot replay previous user queue', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a'); await a.engine.sync(DATE);
  a.engine.enqueue(DATE, a.engine.viewDay(DATE).tasks[0].id, true);
  const other = f.client('stranger', a.storage); await other.engine.sync(DATE);
  assert.equal(other.engine.state.family, null); assert.deepEqual(other.engine.state.queue, []);
});

test('storage failure does not pretend a local check-in was saved', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a'); await a.engine.sync(DATE);
  const engine = new SyncEngine({ transport: async () => {}, storage: { read: () => a.storage.read(), write: () => { throw new Error('磁盘已满'); } } });
  assert.throws(() => engine.enqueue(DATE, engine.viewDay(DATE).tasks[0].id, true), /磁盘已满/);
  assert.equal(engine.viewDay(DATE).tasks[0].done, false); assert.equal(engine.state.queue.length, 0);
});

test('changing date during an active sync fetches the requested history afterward', async () => {
  const f = fixture(); await f.family(); const a = f.client('parent-a');
  await Promise.all([a.engine.sync(DATE), a.engine.sync('2026-10-11')]);
  assert.equal(a.engine.lastDate, '2026-10-11');
});

test('history and progress use child-specific offline caches and revoked membership removes both', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id; const b = f.client('parent-b'); await b.engine.sync(DATE);
  const input = { childId }; const first = await b.engine.getHistory(input); await b.engine.getProgress(input);
  b.offline(); assert.equal((await b.engine.getHistory(input)).cached, true);
  assert.equal((await b.engine.getProgress(input)).cached, true);
  await assert.rejects(b.engine.getProgress({ childId: 'not-cached' }));
  assert.equal(first.cached, false);
  await f.call('parent-a', 'removeMember', { familyId: family.id, memberId: b.engine.state.userId });
  b.online(); await assert.rejects(b.engine.getProgress(input), (error) => error.code === 'FORBIDDEN');
  assert.deepEqual(b.engine.state.histories, {}); assert.deepEqual(b.engine.state.progresses, {});
});

test('late progress or forbidden responses cannot show previous family data or clear the new family cache', async () => {
  for (const forbidden of [false, true]) {
    let resolve; let reject;
    const transport = () => new Promise((a, b) => { resolve = a; reject = b; });
    const engine = new SyncEngine({ transport, storage: memoryStorage() });
    engine.save({ userId: 'old-user', family: { id: 'old-family' }, days: {}, histories: {}, progresses: {}, queue: [] });
    const pending = engine.getProgress({ childId: 'old-child' });
    engine.save({ userId: 'new-user', family: { id: 'new-family' }, days: {}, histories: {}, progresses: {}, queue: [{ mutationId: 'keep-me' }] });
    if (forbidden) { const error = new Error('removed'); error.code = 'FORBIDDEN'; reject(error); }
    else resolve({ stats: { learned: 99 } });
    await assert.rejects(pending);
    assert.equal(engine.state.family.id, 'new-family'); assert.equal(engine.state.queue[0].mutationId, 'keep-me');
    assert.deepEqual(engine.state.progresses, {});
  }
});
