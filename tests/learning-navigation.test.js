const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function setup(t) {
  const calls = [], ticks = [], modals = [], copies = [], stack = [{}];
  global.getCurrentPages = () => stack;
  global.wx = { nextTick: callback => ticks.push(callback), navigateTo: value => calls.push(value),
    showModal: value => modals.push(value), setClipboardData: value => copies.push(value.data) };
  const file = require.resolve('../miniprogram/lib/learning-navigation'); delete require.cache[file];
  const { openLearningPage } = require(file);
  t.after(() => { delete global.wx; delete global.getCurrentPages; });
  return { openLearningPage, calls, ticks, modals, copies, stack };
}

test('card navigation waits for a render tick and serializes rapid taps across learning lists', t => {
  const { openLearningPage, ticks, calls } = setup(t); let complete = 0, success = 0;
  openLearningPage('/pages/study/index?view=plan', { success: () => success++, complete: () => complete++ });
  openLearningPage('/pages/content/index?source=library', { complete: () => complete++ });
  assert.equal(calls.length, 0); assert.equal(ticks.length, 1); assert.equal(complete, 1);
  ticks.shift()(); assert.equal(calls.length, 1);
  calls[0].success({}); calls[0].complete(); assert.equal(complete, 2); assert.equal(success, 1);
  openLearningPage('/pages/content/index?source=library'); ticks.shift()();
  assert.equal(calls.length, 2); calls[1].complete();
});

test('a native tab-transition failure retries once, keeps the same URL and delivers its event channel once', async t => {
  const { openLearningPage, ticks, calls, modals } = setup(t); let channel, complete = 0;
  const url = '/pages/content/index?source=library&id=poem-goose';
  openLearningPage(url, { success: value => { channel = value.eventChannel; }, complete: () => complete++ });
  ticks.shift()(); calls[0].fail({ errMsg: 'navigateTo:fail another page is being routed' }); calls[0].complete();
  assert.equal(complete, 0);
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(calls.length, 2); assert.equal(calls[1].url, url);
  const expected = {}; calls[1].success({ eventChannel: expected }); calls[1].complete();
  assert.equal(channel, expected); assert.equal(complete, 1); assert.deepEqual(modals, []);
});

test('routing errors retain their real platform message and never silently redirect or leak child identifiers', async t => {
  const { openLearningPage, ticks, calls, modals, copies } = setup(t); let complete = 0;
  openLearningPage('/pages/study/index?familyId=private-family&childId=private-child', { complete: () => complete++ });
  ticks.shift()();
  const error = { errMsg: 'navigateTo:fail page "pages/study/index" is not found' };
  calls[0].fail(error); calls[0].complete();
  assert.equal(complete, 1); assert.equal(modals.length, 1); assert.ok(modals[0].content.includes(error.errMsg));
  modals[0].success({ confirm: true }); assert.ok(copies[0].includes(error.errMsg)); assert.ok(!copies[0].includes('private-'));
  assert.equal(calls.length, 1, 'a missing page is not a transient routing error');
  openLearningPage('/pages/content/index?id=poem-goose'); ticks.shift()(); calls[1].complete();
  assert.equal(calls.length, 2, 'a failed navigation releases its lock');
});

test('leaving the origin cancels deferred navigation instead of opening a page over the next tab', t => {
  const { openLearningPage, ticks, calls, stack } = setup(t); let complete = 0;
  openLearningPage('/pages/content/index?id=poem-goose', { complete: () => complete++ });
  stack[0] = {}; ticks.shift()(); assert.equal(calls.length, 0); assert.equal(complete, 1);
});

test('all learning detail destinations and their page assets are registered in the preview package', () => {
  const config = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  for (const page of ['pages/study/index', 'pages/content/index']) {
    assert.ok(config.pages.includes(page)); assert.ok(!config.tabBar.list.some(item => item.pagePath === page));
    for (const ext of ['js', 'json', 'wxml', 'wxss']) assert.ok(fs.existsSync(`miniprogram/${page}.${ext}`));
  }
});
