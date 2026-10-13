const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudTransport } = require('../miniprogram/lib/cloud-transport');
const { fixture } = require('./helpers');
const { createService } = require('../cloudfunctions/familyApi/service');

test('typed transport preserves the v1 wire envelope and service errors', async () => {
  const calls = [];
  let response = { ok: true, data: { day: { date: '2026-10-13', tasks: [] }, today: '2026-10-13' } };
  const transport = createCloudTransport({ callFunction: async (input) => { calls.push(input); return { result: response }; } }, 'test-environment');
  const payload = { familyId: 'family', date: '2026-10-13' };
  assert.deepEqual(await transport('getDay', payload), response.data);
  assert.deepEqual(calls, [{ name: 'familyApi', data: { action: 'getDay', payload } }]);
  response = { ok: false, error: { code: 'CONFLICT', message: '家人已更新学习记录' } };
  await assert.rejects(transport('getDay', payload), { code: 'CONFLICT', message: '家人已更新学习记录' });
  for (response of [null, {}, { ok: true }, { ok: 'true', data: {} }, { ok: false, error: null }])
    await assert.rejects(transport('getDay', payload), /云函数返回异常/);
  await assert.rejects(createCloudTransport(undefined, '')('bootstrap', {}), /云开发尚未配置/);
});

test('untyped or malicious callers still hit runtime authorization and payload validation', async () => {
  const f = fixture();
  const family = await f.family();
  const childId = family.children[0].id;
  await assert.rejects(f.call('outsider', 'getHistory', { familyId: family.id, childId }), { code: 'FORBIDDEN' });
  for (const payload of [null, [], 'not JSON object'])
    await assert.rejects(f.call('parent-a', 'getDay', payload), { code: 'INVALID' });
  await assert.rejects(f.call('parent-a', 'updateChild', { familyId: family.id, childId, name: '测试孩子', schoolGrade: '一年级', baseVersion: 0 }), { code: 'INVALID' });
  const { day } = await f.call('parent-a', 'getDay', { familyId: family.id });
  const task = day.tasks[0];
  await assert.rejects(f.call('parent-a', 'setTaskDone', { familyId: family.id, date: day.date, taskId: task.id, mutationId: 'invalid-done', done: 'true', baseVersion: 0 }), { code: 'INVALID' });
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id })).day.tasks[0].done, false);
  await assert.rejects(f.call('parent-a', 'unknown-action', { familyId: family.id }), { code: 'INVALID' });
});

test('pre-migration v1 records retain identity, mastery and retry receipts without a database migration', async () => {
  const snapshot = require('./fixtures/v1-family.json');
  const database = structuredClone(snapshot.database);
  const store = { run: async (work) => work({
    get: async (collection, id) => structuredClone(database[`${collection}/${id}`] || null),
    put: async (collection, id, value) => { database[`${collection}/${id}`] = structuredClone(value); }
  }) };
  const service = createService({ store, now: () => Date.parse(snapshot.now) });
  const { family } = await service.execute('owner', 'bootstrap', { ensureDefault: true });
  assert.equal(family.children[0].name, '测试孩子');
  assert.equal(family.children[0].birthDate, '2020-01-01');
  assert.equal(family.children[0].schoolGrade, 1);
  assert.deepEqual(database, snapshot.database, 'bootstrap must reuse the original household');
  const input = { familyId: family.id, childId: family.children[0].id };
  const history = await service.execute('owner', 'getHistory', input);
  assert.equal(history.items[0].mastered, true);
  assert.equal(history.items[0].learnedCount, 1);
  const progress = await service.execute('owner', 'getProgress', input);
  assert.equal(progress.stats.mastered, 1);
  const originalDay = Object.values(database).find((record) => record.date && record.tasks);
  const originalTask = originalDay.tasks.find((task) => task.done);
  // A removed member cannot replay an old successful operation/receipt.
  await assert.rejects(service.executeRaw('guardian', 'setTaskDone', {
    familyId: family.id, date: originalDay.date, taskId: originalTask.id,
    done: true, baseVersion: 0, mutationId: 'checkin-one'
  }), { code: 'FORBIDDEN' });
  await service.execute('owner', 'setTaskDone', {
    familyId: family.id, date: originalDay.date, taskId: originalTask.id,
    done: false, baseVersion: originalTask.version, mutationId: 'upgrade-undo'
  });
  assert.equal((await service.execute('owner', 'getHistory', input)).stats.mastered, 0);
});
