const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { memoryStorage, fixture } = require('./helpers');
const learning = require('../shared/learning');
const root = path.resolve(__dirname, '..');

function page(name, engine) {
  let definition;
  global.Page = (value) => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index.js`); delete require.cache[file]; require(file);
  const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), engine, active: true,
    setData(patch) { Object.assign(this.data, patch); } };
  return instance;
}

test('all WXML event handlers exist; family profile, manual cross-grade work, library and progress form one working demo flow', async (t) => {
  const store = new Map(); const navigations = [];
  global.wx = { getStorageSync: (key) => store.get(key), setStorageSync: (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
    showToast() {}, switchTab: (value) => navigations.push(value.url), navigateTo: (value) => navigations.push(value.url) };
  const engine = new SyncEngine({ transport: createDemo(global.wx), storage: memoryStorage() });
  const app = { engine, mode: 'demo', navigation: {} }; global.getApp = () => app;
  t.after(() => { delete global.wx; delete global.getApp; delete global.Page; });
  const names = ['today', 'plans', 'library', 'history', 'family', 'progress', 'study'];
  for (const name of names) {
    const instance = page(name, engine);
    const template = fs.readFileSync(path.join(root, `miniprogram/pages/${name}/index.wxml`), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?::?[a-z]+)="([a-zA-Z]\w*)"/g)) assert.equal(typeof instance[match[1]], 'function', `${name}: missing ${match[1]}`);
  }
  const family = page('family', engine); await engine.sync(); family.render();
  const child = family.data.children[0]; assert.equal(child.age, 6); assert.equal(child.schoolGrade, 1);
  family.editChild({ currentTarget: { dataset: { id: child.id } } });
  await family.saveChild({ detail: { value: { name: '小树', age: '7' } } });
  assert.equal(family.data.children[0].age, 7); assert.equal(family.data.editingChild, null);
  family.editChild({ currentTarget: { dataset: { id: child.id } } });
  const birthDate = `${Number(engine.today.slice(0, 4)) - 6}-01-01`;
  family.changeBirthDate({ currentTarget: { dataset: { field: 'editBirthDate' } }, detail: { value: birthDate } });
  await family.saveChild({ detail: { value: { name: '小树' } } });
  assert.equal(family.data.children[0].birthDate, birthDate); assert.equal(family.data.children[0].age, 6);
  family.openProgress({ currentTarget: { dataset: { id: child.id } } });
  assert.equal(navigations.at(-1), '/pages/progress/index');

  const plans = page('plans', engine); plans.render(); plans.setData({ kindIndex: 3, studyGrade: 3 });
  await plans.addPlan({ detail: { value: { title: '自主阅读', detail: '说明经过', minutes: '8' } } });
  const task = engine.viewDay(engine.today).tasks.find((item) => item.title === '自主阅读');
  assert.equal(task.studyGrade, 3); engine.enqueue(engine.today, task.id, true); await engine.sync(engine.today);
  const progress = page('progress', engine); progress.render(); await progress.loadProgress();
  assert.equal(progress.data.progress.grades[2].parentLearned, 1); assert.equal(progress.data.children[0].schoolGrade, 1);
  progress.browseGrade({ currentTarget: { dataset: { grade: 6 } } });
  const library = page('library', engine); library.onShow(); library.cleanup();
  assert.equal(library.data.total, 10);
  await library.assignItem({ currentTarget: { dataset: { id: library.data.items[0].id } } });
  assert.equal(library.data.items[0].assigned, true);
  progress.openExamScope(); library.onShow(); library.cleanup();
  assert.equal(library.data.view, 'exam'); assert.equal(library.data.resources.examFramework.complete, false);
  library.showExamContent({ currentTarget: { dataset: { kind: 'word' } } });
  assert.equal(library.data.view, 'content'); assert.equal(library.data.total, 1677);
  assert.equal(library.data.grade, 0); assert.equal(library.data.subjectFilter, 'english');
});

test('today summarizes 30 words, opens a scoped detail route and completes, syncs and undoes only that child and type', async (t) => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id; const date = '2026-10-12';
  const call = (action, payload) => f.call('parent-a', action, { familyId: family.id, childId, ...payload });
  const quantities = { poetry: 2, word: 30, sentence: 1, reading: 1, math: 3 };
  await call('saveAutoPlans', { rules: learning.emptyRules().map((rule) => ({ ...rule, quantity: quantities[rule.kind] || 0,
    scope: rule.kind === 'word' ? 'foundation' : 'starter' })) });
  await call('addPlan', { title: 'The little cat', detail: 'A little cat sits in the sun.', kind: 'english-reading', subject: 'english', minutes: 5, schedule: 'once' });
  const added = await call('addChild', { name: '另一个孩子' }); const otherChild = added.family.children[1];
  await call('addPlan', { childId: otherChild.id, title: 'hello', kind: 'word', subject: 'english', minutes: 2, schedule: 'once' });
  const a = f.client('parent-a'); const b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  const firstWord = a.engine.viewDay(date).tasks.find((task) => task.childId === childId && task.kind === 'word');
  a.engine.enqueue(date, firstWord.id, true); await a.engine.sync(date);
  const toasts = []; const navigations = [];
  global.wx = { showToast: (value) => toasts.push(value.title), navigateTo: (value) => { navigations.push(value); } };
  const app = { engine: a.engine, mode: 'cloud', navigation: {} }; global.getApp = () => app;
  const today = page('today', a.engine); today.render();
  const unsubscribe = a.engine.subscribe(() => today.render());
  t.after(() => { unsubscribe(); delete global.wx; delete global.getApp; delete global.Page; });
  const event = (id) => ({ currentTarget: { dataset: { id } } });
  const words = () => today.data.groups.find((group) => group.id === 'word');
  assert.equal(today.data.groupCount, 6);
  assert.equal(today.data.allTaskCount, 38);
  assert.equal(words().count, 30); assert.equal(words().doneCount, 1);
  assert.ok(today.data.groups.every((group) => !('items' in group)), 'today sends summaries instead of long word lists');
  assert.equal(today.data.subjectOptions.find((subject) => subject.id === 'english').count, 3);
  assert.equal(today.data.groups.find((group) => group.id === 'english-reading').label, '阅读英文文章');

  for (const group of today.data.groups) {
    today.openGroup(event(group.id));
    const navigation = navigations.at(-1);
    const route = new URL(navigation.url, 'https://local.test');
    assert.equal(route.pathname, '/pages/study/index');
    assert.deepEqual(Object.fromEntries(route.searchParams), { familyId: family.id, childId, date, kind: group.id });
    today.openGroup(event(group.id)); assert.equal(navigations.at(-1), navigation, 'a second tap while opening must not stack pages');
    navigation.complete();
  }
  assert.equal(navigations.length, 6);
  today.openGroup(event('unknown')); assert.equal(navigations.length, 6);
  a.offline(); await today.toggleGroup(event('word'));
  assert.equal(words().done, true); assert.equal(words().pendingCount, 29);
  assert.equal(a.engine.state.queue.length, 29, 'the already completed word is not written again');
  assert.equal(today.data.doneGroupCount, 1); assert.equal(today.data.groupPercent, 17);
  assert.ok(a.engine.viewDay(date).tasks.filter((task) => task.childId !== childId || task.kind !== 'word').every((task) => !task.done));
  today.selectSubject(event('english'));
  assert.equal(today.data.groups.length, 3);
  today.selectChild(event(otherChild.id));
  assert.equal(words().count, 1); assert.equal(words().done, false);
  today.selectChild(event(childId)); a.online(); await a.engine.sync(date); await b.engine.sync(date);
  const remoteWords = b.engine.viewDay(date).tasks.filter((task) => task.childId === childId && task.kind === 'word');
  assert.ok(remoteWords.every((task) => task.done && task.version === 1));
  const history = await b.engine.getHistory({ childId });
  assert.equal(history.total, 30); assert.ok(history.items.every((item) => item.kind === 'word' && item.learnedCount === 1 && !item.mastered));
  await today.changeDate({ detail: { value: '2026-10-11' } });
  assert.equal(today.data.groups.length, 0);
  await today.backToday(); assert.equal(words().done, true);
  await today.toggleGroup(event('word')); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every((task) => !task.done));
  assert.equal((await b.engine.getHistory({ childId })).total, 0);
  assert.equal(today.data.doneGroupCount, 0); assert.deepEqual(toasts, []);
});

test('the full today card opens details while its group completion button stops tap propagation', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/today/index.wxml'), 'utf8');
  assert.match(template, /<view[^>]+class="card activity-card"[^>]+bindtap="openGroup"/);
  assert.match(template, /<button[^>]+catchtap="toggleGroup"/);
  assert.doesNotMatch(template, /bindtap="toggleGroup"/);
});
