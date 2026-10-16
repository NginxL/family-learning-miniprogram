const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const learning = require('../shared/learning');
const DATE = '2026-10-12';

function page(name, engine) {
  let definition;
  global.Page = (value) => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`);
  delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, route: `pages/${name}/index`, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
}
async function setup(t) {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id;
  const added = await f.call('parent-a', 'addChild', { familyId: family.id, name: '小禾' });
  const otherChild = added.family.children[1].id;
  await f.call('parent-a', 'saveAutoPlans', { familyId: family.id, childId,
    rules: learning.emptyRules().map((rule) => ({ ...rule, quantity: rule.kind === 'word' ? 30 : rule.kind === 'poetry' ? 1 : 0,
      scope: rule.kind === 'word' ? 'foundation' : 'starter' })) });
  await f.call('parent-a', 'addPlan', { familyId: family.id, childId: otherChild, title: '另一个孩子的 apple', detail: 'apple 苹果',
    kind: 'word', subject: 'english', minutes: 2, schedule: 'daily' });
  await f.call('parent-a', 'addPlan', { familyId: family.id, childId, title: 'The cat', detail: 'A cat sits in the sun.\nIt is warm.',
    kind: 'english-reading', subject: 'english', minutes: 5, schedule: 'daily' });
  const a = f.client('parent-a'); const b = f.client('parent-b');
  await a.engine.sync(DATE); await b.engine.sync(DATE);
  const toasts = []; const tabs = [];
  global.wx = { showToast: (value) => toasts.push(value.title), switchTab: (value) => tabs.push(value.url), stopPullDownRefresh() {} };
  const app = { engine: a.engine, mode: 'cloud', navigation: {} };
  global.getApp = () => app;
  t.after(() => { delete global.Page; delete global.wx; delete global.getApp; });
  const route = { familyId: family.id, childId, date: DATE, kind: 'word' };
  const study = page('study', a.engine); study.onLoad(route); study.render();
  return { f, family, childId, otherChild, a, b, app, study, route, toasts, tabs };
}

test('details show the stored poem and English text, sources and notes without altering learning records', async (t) => {
  const { a, study, route } = await setup(t);
  const before = a.engine.snapshot();
  for (const kind of ['poetry', 'word', 'english-reading']) {
    study.onLoad({ ...route, kind }); study.render();
    const tasks = a.engine.viewDay(DATE).tasks.filter((task) => task.childId === route.childId && task.kind === kind);
    assert.equal(study.data.group.count, tasks.length);
    for (const [index, item] of study.data.items.entries()) {
      for (const field of ['id', 'title', 'detail', 'source', 'note', 'done', 'version']) assert.equal(item[field], tasks[index][field]);
    }
    assert.equal(study.data.childName, '小树'); assert.equal(study.data.date, DATE);
  }
  assert.deepEqual(a.engine.snapshot(), before, 'viewing details must not mark anything as learned');
  assert.equal(study.route, 'pages/study/index', 'the native Page.route property must remain intact');
});

test('paged words complete and undo the whole group offline, sync to the other phone and update today', async (t) => {
  const { a, b, study, childId, route, toasts } = await setup(t);
  const words = () => a.engine.viewDay(DATE).tasks.filter((task) => task.childId === childId && task.kind === 'word');
  a.engine.enqueue(DATE, words()[0].id, true); await a.engine.sync(DATE); study.render();
  assert.equal(study.data.items.length, 20); assert.equal(study.data.group.count, 30);
  assert.equal(study.data.group.doneCount, 1);
  a.offline(); await study.toggleGroup();
  assert.equal(study.data.group.done, true); assert.equal(study.data.group.pendingCount, 29);
  assert.equal(a.engine.state.queue.length, 29, 'already completed entries are not re-enqueued');
  assert.ok(words().every((task) => task.done), 'all 30 words complete even though only 20 are visible');
  assert.ok(a.engine.viewDay(DATE).tasks.filter((task) => task.childId !== childId || task.kind !== 'word').every((task) => !task.done));
  study.showMore(); assert.equal(study.data.items.length, 30); assert.ok(study.data.items.every((task) => task.done));
  await study.refresh(); assert.equal(study.data.items.length, 30, 'refresh preserves the expanded batch');
  a.online(); await study.refresh(); await b.engine.sync(DATE);
  assert.equal(study.data.group.pendingCount, 0); assert.equal(study.data.syncLabel, '已同步');
  assert.ok(b.engine.viewDay(DATE).tasks.filter((task) => task.childId === childId && task.kind === 'word').every((task) => task.done));
  const today = page('today', a.engine); today.setData({ childId, date: route.date, followToday: false }); today.render();
  assert.equal(today.data.groups.find((group) => group.id === 'word').done, true);
  await study.toggleGroup(); await b.engine.sync(DATE); today.render();
  assert.ok(b.engine.viewDay(DATE).tasks.every((task) => !task.done));
  assert.equal(today.data.groups.find((group) => group.id === 'word').doneCount, 0);
  assert.deepEqual(toasts, []);
});

test('details stay on the selected child and date across navigation changes and midnight', async (t) => {
  const { f, a, b, study, childId, otherChild, app } = await setup(t);
  f.advance(86400000); await a.engine.sync('2026-10-13');
  app.navigation = { childId: otherChild, subject: 'poetry', date: '2026-10-13' };
  study.onShow(); t.after(() => study.onUnload()); await study.refresh();
  assert.equal(study.data.date, DATE); assert.equal(study.data.childName, '小树');
  assert.ok(study.data.items.every((task) => task.childId === childId && task.kind === 'word'));
  await study.toggleGroup(); await b.engine.sync(DATE);
  assert.ok(b.engine.viewDay(DATE).tasks.filter((task) => task.childId === childId && task.kind === 'word').every((task) => task.done));
  await b.engine.sync('2026-10-13');
  assert.ok(b.engine.viewDay('2026-10-13').tasks.length > 0);
  assert.ok(b.engine.viewDay('2026-10-13').tasks.every((task) => !task.done));
  assert.deepEqual(app.navigation, { childId: otherChild, subject: 'poetry', date: '2026-10-13' });
});

test('invalid detail links do not fetch or enqueue tasks, and empty dates have a usable exit', async (t) => {
  const { a, study, route, tabs } = await setup(t);
  let requests = 0;
  const sync = a.engine.sync.bind(a.engine);
  a.engine.sync = async (...args) => { requests++; return sync(...args); };
  for (const input of [{}, { ...route, date: '2026-02-30' }, { ...route, date: '2026-10-13' },
    { ...route, kind: 'words' }, { ...route, familyId: '../other' }, { ...route, childId: '' }]) {
    study.onLoad(input); study.render(); await study.refresh(); await study.toggleGroup();
    assert.equal(study.data.group, null); assert.ok(study.data.pageError); assert.equal(study.data.loading, false);
  }
  assert.equal(requests, 0); assert.equal(a.engine.state.queue.length, 0);
  study.onLoad({ ...route, date: '2026-10-11' }); await study.refresh();
  assert.equal(study.data.group, null); assert.equal(study.data.emptyMessage, '这一天没有这类学习任务。');
  study.openToday(); assert.deepEqual(tabs, ['/pages/today/index']);
});

test('removed children and a changed family cannot redirect a stale detail completion to another record', async (t) => {
  const { a, study, route, otherChild } = await setup(t);
  const original = structuredClone(a.engine.state);
  a.engine.state.family.children = a.engine.state.family.children.filter((child) => child.id === otherChild);
  await study.toggleGroup();
  assert.equal(study.data.group, null); assert.ok(study.data.pageError); assert.equal(a.engine.state.queue.length, 0);
  a.engine.state = structuredClone(original); study.render();
  a.engine.state.family.id = 'another-family';
  a.engine.state.days[`another-family:${DATE}`] = { ...original.days[`${route.familyId}:${DATE}`], familyId: 'another-family' };
  let requests = 0; a.engine.sync = async () => { requests++; };
  await study.toggleGroup(); await study.refresh();
  assert.equal(study.data.group, null); assert.equal(study.data.items.length, 0);
  assert.equal(study.data.childName, ''); assert.ok(study.data.pageError);
  assert.equal(a.engine.state.queue.length, 0); assert.equal(requests, 0);
});

test('failed persistence leaves the entire group untouched and repeated taps during sync do not undo it', async (t) => {
  const { a, study, toasts } = await setup(t);
  const write = a.engine.storage.write;
  a.engine.storage.write = () => { throw new Error('本机存储空间不足'); };
  await study.toggleGroup();
  assert.equal(study.data.group.doneCount, 0); assert.equal(study.data.busy, false);
  assert.equal(a.engine.state.queue.length, 0); assert.deepEqual(toasts, ['本机存储空间不足']);
  a.engine.storage.write = write;
  let finish; a.engine.sync = () => new Promise((resolve) => { finish = resolve; });
  const firstTap = study.toggleGroup(); await study.toggleGroup();
  assert.equal(study.data.busy, true); assert.equal(a.engine.state.queue.length, 30);
  assert.equal(study.data.group.done, true);
  study.onHide();
  const hiddenData = structuredClone(study.data);
  finish(); await firstTap;
  assert.deepEqual(study.data, hiddenData, 'a completed request must not repaint an unloaded page');
  a.engine.sync = async () => {};
  study.onShow(); t.after(() => study.onUnload()); assert.equal(study.data.busy, false);
});

test('detail subscriptions and timers are released and hidden pages do not repaint', async (t) => {
  const { a, study } = await setup(t);
  const timers = new Set();
  const originalSet = global.setInterval; const originalClear = global.clearInterval;
  global.setInterval = () => { const timer = {}; timers.add(timer); return timer; };
  global.clearInterval = (timer) => timers.delete(timer);
  t.after(() => { study.onUnload(); global.setInterval = originalSet; global.clearInterval = originalClear; });
  let finish; a.engine.sync = () => new Promise((resolve) => { finish = resolve; });
  study.onShow();
  assert.equal(a.engine.listeners.size, 1); assert.equal(timers.size, 1);
  study.showMore(); study.onHide();
  const data = structuredClone(study.data);
  assert.equal(a.engine.listeners.size, 0); assert.equal(timers.size, 0);
  a.engine.error = '断网'; a.engine.emit(); finish(); await new Promise(setImmediate);
  assert.deepEqual(study.data, data);
  study.onShow(); assert.equal(study.data.items.length, 30); assert.equal(study.data.syncError, '断网');
  assert.equal(a.engine.listeners.size, 1); assert.equal(timers.size, 1);
  study.onUnload(); finish();
  assert.equal(a.engine.listeners.size, 0); assert.equal(timers.size, 0);
});
