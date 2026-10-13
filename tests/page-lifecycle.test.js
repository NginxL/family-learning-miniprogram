const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const DATE = '2026-10-12';

function loadPage(name, engine) {
  let definition;
  global.Page = (value) => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`);
  delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function environment(t) {
  const f = fixture(); const family = await f.family();
  await f.call('parent-a', 'addChild', { familyId: family.id, name: '测试孩子乙' });
  const { engine } = f.client('parent-a'); await engine.sync(DATE);
  const app = { engine, mode: 'cloud', navigation: {} };
  global.getApp = () => app;
  global.wx = { showToast() {}, switchTab() {} };
  t.after(() => { delete global.Page; delete global.getApp; delete global.wx; });
  return { engine, children: engine.state.family.children };
}

for (const name of ['history', 'progress']) {
  test(`${name} ignores delayed results for another child and results arriving after the page is hidden`, async (t) => {
    const { engine, children } = await environment(t);
    const method = name === 'history' ? 'getHistory' : 'getProgress';
    const loader = name === 'history' ? 'loadHistory' : 'loadProgress';
    const original = await engine[method]({ childId: children[0].id });
    const requests = [];
    engine[method] = (input) => { const result = deferred(); requests.push({ ...result, input }); return result.promise; };
    const page = loadPage(name, engine); page.render();
    const loads = []; const load = page[loader];
    page[loader] = function (...args) { const result = load.apply(this, args); loads.push(result); return result; };
    const marker = () => name === 'history' ? page.data.historyTotal : page.data.progress?.stats.learned;
    const response = (value) => ({ ...structuredClone(original), total: value, stats: { ...original.stats, learned: value }, cached: false });
    page[loader]();
    page.selectChild({ currentTarget: { dataset: { id: children[1].id } } });
    assert.deepEqual(requests.map((request) => request.input.childId), children.map((child) => child.id));
    requests[1].resolve(response(22)); await loads[1];
    assert.equal(marker(), 22);
    requests[0].resolve(response(11)); await loads[0];
    assert.equal(marker(), 22, 'the previous child must not repaint the current page');
    page[loader](); page.onHide();
    requests[2].resolve(response(33)); await loads[2];
    assert.equal(marker(), 22, 'a hidden page must not accept a late result');
    assert.equal(page.active, false);
  });
}

test('page show/hide/unload releases the sync subscription and 20-second refresh timer', async (t) => {
  const { engine } = await environment(t);
  const timers = new Map(); let timerId = 0;
  const originalSet = global.setInterval; const originalClear = global.clearInterval;
  global.setInterval = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  global.clearInterval = (id) => timers.delete(id);
  t.after(() => { global.setInterval = originalSet; global.clearInterval = originalClear; });
  // Isolate lifecycle bookkeeping from network timing; sync behavior is covered separately.
  engine.sync = async () => {};
  const page = loadPage('today', engine);
  page.onShow();
  assert.equal(engine.listeners.size, 1); assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 20000);
  page.onHide(); assert.equal(engine.listeners.size, 0); assert.equal(timers.size, 0);
  page.onShow(); assert.equal(engine.listeners.size, 1); assert.equal(timers.size, 1);
  page.onUnload(); assert.equal(engine.listeners.size, 0); assert.equal(timers.size, 0);
  assert.equal(page.active, false);
});

test('history search replaces the previous debounce and cancels it when leaving the page', async (t) => {
  const { engine } = await environment(t);
  const timers = new Map(); let timerId = 0;
  const originalSet = global.setTimeout; const originalClear = global.clearTimeout;
  global.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  t.after(() => { global.setTimeout = originalSet; global.clearTimeout = originalClear; });
  const page = loadPage('history', engine);
  page.typeQuery({ detail: { value: 'apple' } });
  page.typeQuery({ detail: { value: 'banana' } });
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 350);
  assert.equal(page.data.query, 'banana');
  page.onUnload(); assert.equal(timers.size, 0);
});
