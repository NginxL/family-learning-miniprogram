const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../cloudfunctions/familyApi/service');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const snapshot = require('./fixtures/v1-sync-cache.json');

function restoredClient(initial = snapshot.cache) {
  const database = structuredClone(snapshot.database);
  let cache = structuredClone(initial);
  let online = false;
  let loseResponse = false;
  const writes = [];
  const service = createService({ now: () => Date.parse(snapshot.now), store: { run: (work) => work({
    get: async (collection, id) => structuredClone(database[`${collection}/${id}`] || null),
    put: async (collection, id, value) => { database[`${collection}/${id}`] = structuredClone(value); }
  }) } });
  const storage = { read: () => structuredClone(cache), write: (value) => { cache = structuredClone(value); } };
  const transport = async (action, payload) => {
    if (!online) throw new Error('模拟断网');
    if (action === 'setTaskDone') writes.push(structuredClone(payload));
    const result = await service.execute(snapshot.openid, action, payload);
    if (action === 'setTaskDone' && loseResponse) { loseResponse = false; throw new Error('已提交但响应丢失'); }
    return result;
  };
  return { storage, writes, engine: () => new SyncEngine({ storage, transport }),
    connect: () => { online = true; }, loseNextResponse: () => { loseResponse = true; } };
}

test('pre-migration JS cache restores history, progress and queued writes with the original retry IDs', async () => {
  const client = restoredClient(); const engine = client.engine();
  const childId = snapshot.cache.family.children[0].id;
  assert.deepEqual(engine.state, snapshot.cache, 'loading must not rewrite the v1 cache');
  const day = engine.viewDay(snapshot.date);
  assert.deepEqual(day.tasks.map((task) => [task.done, task.pending]), [[false, true], [true, true]]);
  const history = await engine.getHistory({ childId });
  const progress = await engine.getProgress({ childId });
  assert.equal(history.cached, true); assert.equal(history.stats.learned, 1);
  assert.equal(progress.cached, true); assert.equal(progress.stats.learned, 1);
  client.connect(); client.loseNextResponse();
  await engine.sync(snapshot.date);
  assert.equal(engine.status, 'offline');
  assert.deepEqual(client.storage.read().queue, snapshot.cache.queue);
  const restarted = client.engine(); await restarted.sync(snapshot.date);
  assert.equal(restarted.status, 'online'); assert.deepEqual(restarted.state.queue, []);
  assert.deepEqual(client.writes, [snapshot.cache.queue[0], snapshot.cache.queue[0], snapshot.cache.queue[1]]);
  assert.deepEqual(restarted.viewDay(snapshot.date).tasks.map((task) => [task.done, task.version]), [[false, 2], [true, 1]]);
  const updated = await restarted.getHistory({ childId });
  assert.equal(updated.cached, false); assert.equal(updated.total, 1);
  assert.equal(updated.items[0].contentId, day.tasks[1].contentId);
});

test('older caches without history/progress buckets keep queued work and lazily populate new reads', async () => {
  const old = structuredClone(snapshot.cache);
  delete old.histories; delete old.progresses; delete old.notice;
  const client = restoredClient(old); const engine = client.engine();
  const input = { childId: old.family.children[0].id };
  assert.deepEqual(engine.state, old);
  await assert.rejects(engine.getHistory(input), /模拟断网/);
  assert.deepEqual(client.storage.read(), old);
  client.connect();
  await engine.getHistory(input); await engine.getProgress(input);
  assert.equal(Object.keys(engine.state.histories).length, 1);
  assert.equal(Object.keys(engine.state.progresses).length, 1);
  assert.deepEqual(engine.state.queue, old.queue);
  await engine.sync(snapshot.date);
  assert.equal(engine.state.queue.length, 0);
});

test('plain wx rejection objects retain their message and unknown failures leave the UI usable', async () => {
  for (const [failure, expected] of [[{ errMsg: 'request:fail', message: '网络不可用' }, '网络不可用'], [null, '暂时无法连接，联网后会继续同步']]) {
    const engine = new SyncEngine({ transport: async () => { throw failure; }, storage: { read: () => null, write() {} } });
    await engine.sync(snapshot.date);
    assert.equal(engine.status, 'offline'); assert.equal(engine.error, expected);
    assert.deepEqual(engine.viewDay(snapshot.date), { date: snapshot.date, tasks: [] });
  }
});
