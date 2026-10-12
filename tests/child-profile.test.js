const test = require('node:test');
const assert = require('node:assert/strict');
const { ageFromBirthDate, withCurrentAge } = require('../shared/child-profile');
const { fixture, memoryStorage } = require('./helpers');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { common } = require('../miniprogram/lib/page');

test('age follows calendar birthdays, including leap days, and rejects impossible or future dates', () => {
  assert.equal(ageFromBirthDate('2020-10-13', '2026-10-12'), 5);
  assert.equal(ageFromBirthDate('2020-10-13', '2026-10-13'), 6);
  assert.equal(ageFromBirthDate('2020-10-13', '2027-10-13'), 7);
  assert.equal(ageFromBirthDate('2020-02-29', '2027-02-28'), 6);
  assert.equal(ageFromBirthDate('2020-02-29', '2027-03-01'), 7);
  assert.equal(ageFromBirthDate('2026-10-12', '2026-10-12'), 0);
  for (const value of [null, '', 123, '2020.10.13', '2020-02-30', '2021-02-29', '2026-10-13'])
    assert.equal(ageFromBirthDate(value, '2026-10-12'), null);
  assert.deepEqual(withCurrentAge({ age: 6, schoolGrade: 1 }, '2027-10-13'), { age: 6, schoolGrade: 1 });
});

test('cloud profiles advance at Shanghai birthday midnight without writes, grade changes or losing the date on legacy edits', async () => {
  const f = fixture({ defaultChild: { name: '测试孩子', birthDate: '2020-10-13', age: 6, schoolGrade: 1 } });
  const first = (await f.call('parent-a', 'bootstrap', { ensureDefault: true })).family;
  assert.equal(first.children[0].age, 5);
  await f.addParent(first.id);
  const before = f.inspect();
  f.advance(14 * 3600000 - 1);
  assert.equal((await f.call('parent-a', 'bootstrap')).family.children[0].age, 5);
  f.advance(1);
  const child = (await f.call('parent-b', 'bootstrap')).family.children[0];
  assert.equal(child.age, 6); assert.equal(child.schoolGrade, 1); assert.equal(child.version, 0);
  assert.deepEqual(f.inspect(), before, 'age updates must not rewrite the profile or its version');
  const payload = { familyId: first.id, childId: child.id, name: '新昵称', age: 9, schoolGrade: 1, baseVersion: 0 };
  for (const birthDate of ['2026-10-14', '2020-02-30', 'not-a-date'])
    await assert.rejects(f.call('parent-a', 'updateChild', { ...payload, birthDate }), (error) => error.code === 'INVALID');
  const updated = (await f.call('parent-a', 'updateChild', payload)).family.children[0];
  assert.equal(updated.birthDate, '2020-10-13'); assert.equal(updated.age, 6);
  f.advance(365 * 86400000);
  assert.equal((await f.call('parent-a', 'bootstrap')).family.children[0].age, 7);
  const cleared = (await f.call('parent-a', 'updateChild', { ...payload, birthDate: null, age: 7, baseVersion: 1 })).family.children[0];
  assert.equal(cleared.birthDate, null);
});

test('adding a private default birthday only fills an untouched matching default, once, and keeps explicit edits', async () => {
  const defaults = { name: '测试孩子', age: 6, schoolGrade: 1 };
  const f = fixture({ defaultChild: defaults });
  const a = (await f.call('parent-a', 'bootstrap', { ensureDefault: true })).family;
  const b = (await f.call('parent-b', 'bootstrap', { ensureDefault: true })).family;
  await f.call('parent-b', 'updateChild', { familyId: b.id, childId: b.children[0].id, name: defaults.name,
    age: 7, schoolGrade: 2, baseVersion: 0 });
  defaults.birthDate = '2020-10-13';
  const migrated = (await f.call('parent-a', 'bootstrap', { ensureDefault: true })).family.children[0];
  assert.equal(migrated.id, a.children[0].id); assert.equal(migrated.birthDate, defaults.birthDate);
  assert.equal(migrated.version, 1); assert.equal(migrated.age, 5);
  assert.equal((await f.call('parent-a', 'bootstrap')).family.children[0].version, 1);
  const edited = (await f.call('parent-b', 'bootstrap', { ensureDefault: true })).family.children[0];
  assert.equal(edited.birthDate, null); assert.equal(edited.age, 7); assert.equal(edited.schoolGrade, 2);
});

test('an offline cached profile and the demo derive a new age after midnight without a cloud response', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T15:59:59Z') });
  const store = new Map();
  const demo = createDemo({ getStorageSync: (key) => store.get(key), setStorageSync: (key, value) => store.set(key, structuredClone(value)) });
  const engine = new SyncEngine({ transport: demo, storage: memoryStorage() });
  await engine.sync();
  const child = engine.snapshot().family.children[0];
  await engine.command('updateChild', { childId: child.id, name: '测试孩子', birthDate: '2020-10-13', schoolGrade: 1, baseVersion: 0 });
  const page = { ...common(), engine, setData(patch) { this.data = { ...this.data, ...patch }; } };
  global.getApp = () => ({ mode: 'demo' });
  t.after(() => { delete global.getApp; });
  page.render(); assert.equal(page.data.children[0].age, 5);
  t.mock.timers.tick(1000);
  page.render(); assert.equal(page.data.children[0].age, 6);
  assert.equal(page.data.children[0].schoolGrade, 1);
  assert.equal(engine.snapshot().family.children[0].age, 5, 'cached server response was not changed');
  assert.equal((await demo('bootstrap')).family.children[0].age, 6);
});
