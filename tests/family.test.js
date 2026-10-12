const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { chinaDate } = require('../cloudfunctions/familyApi/service');
const DATE = '2026-10-12';
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('two guardians share a child and check-in, while outsiders cannot read or mutate it', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const { day } = await f.call('parent-b', 'getDay', { familyId: family.id, date: DATE });
  assert.equal(day.tasks.length, 2);
  await f.call('parent-b', 'setTaskDone', { familyId: family.id, date: DATE, taskId: day.tasks[0].id, done: true, baseVersion: 0, mutationId: 'done1' });
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id, date: DATE })).day.tasks[0].done, true);
  await rejects(f.call('stranger', 'getDay', { familyId: family.id, openid: 'parent-a' }), 'FORBIDDEN');
  await rejects(f.call('stranger', 'setTaskDone', { familyId: family.id }), 'FORBIDDEN');
  assert.equal((await f.call('stranger', 'bootstrap')).family, null);
  await rejects(f.call('', 'bootstrap'), 'UNAUTHENTICATED');
});

test('invite is owner-only, rotated, one-use and expires after 24 hours', async () => {
  const f = fixture(); const family = await f.family();
  const old = await f.call('parent-a', 'createInvite', { familyId: family.id });
  const fresh = await f.call('parent-a', 'createInvite', { familyId: family.id });
  await rejects(f.call('parent-b', 'joinFamily', { code: old.code, memberName: '乙' }), 'INVALID_INVITE');
  await f.call('parent-b', 'joinFamily', { code: fresh.code, memberName: '乙' });
  await rejects(f.call('parent-c', 'joinFamily', { code: fresh.code, memberName: '丙' }), 'INVALID_INVITE');
  await rejects(f.call('parent-b', 'createInvite', { familyId: family.id }), 'FORBIDDEN');
  const expires = await f.call('parent-a', 'createInvite', { familyId: family.id });
  f.advance(24 * 3600000);
  await rejects(f.call('parent-c', 'joinFamily', { code: expires.code, memberName: '丙' }), 'INVALID_INVITE');
  assert.equal(JSON.stringify(f.inspect()).includes(fresh.code), false, 'raw invite codes are not persisted');
});

test('concurrent check-ins use versions; stale operation cannot overwrite another guardian', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const { day } = await f.call('parent-a', 'getDay', { familyId: family.id });
  const payload = { familyId: family.id, date: DATE, taskId: day.tasks[0].id, done: true, baseVersion: 0 };
  const results = await Promise.allSettled([
    f.call('parent-a', 'setTaskDone', { ...payload, mutationId: 'a' }),
    f.call('parent-b', 'setTaskDone', { ...payload, mutationId: 'b', done: false })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'CONFLICT');
});

test('lost-response retry is idempotent and mutation id cannot be reused with a different intent', async () => {
  const f = fixture(); const family = await f.family();
  const { day } = await f.call('parent-a', 'getDay', { familyId: family.id });
  const payload = { familyId: family.id, date: DATE, taskId: day.tasks[0].id, done: true, baseVersion: 0, mutationId: 'stable' };
  await f.call('parent-a', 'setTaskDone', payload);
  assert.equal((await f.call('parent-a', 'setTaskDone', payload)).duplicate, true);
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id })).day.tasks[0].version, 1);
  await rejects(f.call('parent-a', 'setTaskDone', { ...payload, done: false }), 'INVALID');
});

test('removal revokes reads, writes and even replay of a previously acknowledged receipt', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const b = await f.call('parent-b', 'bootstrap');
  const { day } = await f.call('parent-b', 'getDay', { familyId: family.id });
  const payload = { familyId: family.id, date: DATE, taskId: day.tasks[0].id, done: true, baseVersion: 0, mutationId: 'b-check' };
  await f.call('parent-b', 'setTaskDone', payload);
  await rejects(f.call('parent-b', 'removeMember', { familyId: family.id, memberId: family.ownerId }), 'FORBIDDEN');
  await f.call('parent-a', 'removeMember', { familyId: family.id, memberId: b.userId });
  await rejects(f.call('parent-b', 'setTaskDone', payload), 'FORBIDDEN');
  assert.equal((await f.call('parent-b', 'bootstrap')).family, null);
  await rejects(f.call('parent-a', 'leaveFamily', { familyId: family.id }), 'INVALID');
});

test('daily tasks retain history; paused plans stop the next day; no synthetic past assignments', async () => {
  const f = fixture(); const family = await f.family();
  const rules = family.autoPlans[family.children[0].id].map((rule) => ({ ...rule, quantity: 0 }));
  await f.call('parent-a', 'saveAutoPlans', { familyId: family.id, childId: family.children[0].id, rules });
  for (const title of ['每日读书', '每日口算']) await f.call('parent-a', 'addPlan', { familyId: family.id, childId: family.children[0].id, title, subject: 'other', minutes: 5 });
  const { day } = await f.call('parent-a', 'getDay', { familyId: family.id });
  await f.call('parent-a', 'setPlanEnabled', { familyId: family.id, planId: day.tasks[0].id, enabled: false });
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id })).day.tasks.length, 2);
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id, date: '2026-10-11' })).day.tasks.length, 0);
  f.advance(86400000);
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id })).day.tasks.length, 1);
  assert.equal((await f.call('parent-a', 'getDay', { familyId: family.id, date: DATE })).day.tasks.length, 2);
});

test('adding a child and daily task assigns only to that child and validates untrusted inputs', async () => {
  const f = fixture(); const family = await f.family();
  const updated = await f.call('parent-a', 'addChild', { familyId: family.id, name: '小芽' });
  const childId = updated.family.children[1].id;
  const plan = { familyId: family.id, childId, title: '读绘本', subject: 'english', minutes: 8, detail: '读一页' };
  await f.call('parent-a', 'addPlan', plan);
  const { day } = await f.call('parent-a', 'getDay', { familyId: family.id });
  assert.equal(day.tasks.filter((task) => task.childId === childId).length, 1);
  for (const invalid of [{ minutes: -1 }, { subject: 'not-real' }, { childId: 'stranger' }, { title: ' ' }])
    await rejects(f.call('parent-a', 'addPlan', { ...plan, ...invalid }), 'INVALID');
});

test('dates use Shanghai midnight and reject impossible/future dates', async () => {
  assert.equal(chinaDate(Date.parse('2026-10-12T16:00:00Z')), '2026-10-13');
  const f = fixture(); const family = await f.family();
  for (const date of ['2026-02-30', '2026-10-13', '../other', '2020-01-01'])
    await rejects(f.call('parent-a', 'getDay', { familyId: family.id, date }), 'INVALID');
});

test('failed multi-document operation leaves no partial household', async () => {
  const f = fixture();
  await rejects(f.call('parent-a', 'createFamily', { name: '家庭', memberName: '甲', childName: '' }), 'INVALID');
  assert.deepEqual(f.inspect(), {});
  const family = await f.family();
  await rejects(f.call('parent-a', 'createFamily', { name: '重复', memberName: '甲', childName: '乙' }), 'ALREADY_JOINED');
  assert.equal((await f.call('parent-a', 'bootstrap')).family.id, family.id);
});
