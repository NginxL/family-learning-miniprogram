const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDemo } = require('../miniprogram/lib/demo');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const { memoryStorage } = require('./helpers');
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
  const names = ['today', 'plans', 'library', 'history', 'family', 'progress'];
  for (const name of names) {
    const instance = page(name, engine);
    const template = fs.readFileSync(path.join(root, `miniprogram/pages/${name}/index.wxml`), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?::?[a-z]+)="([a-zA-Z]\w*)"/g)) assert.equal(typeof instance[match[1]], 'function', `${name}: missing ${match[1]}`);
  }
  const family = page('family', engine); await family.createDemoFamily(); family.render();
  const child = family.data.children[0]; assert.equal(child.age, 6); assert.equal(child.schoolGrade, 1);
  family.editChild({ currentTarget: { dataset: { id: child.id } } });
  await family.saveChild({ detail: { value: { name: '小树', age: '7' } } });
  assert.equal(family.data.children[0].age, 7); assert.equal(family.data.editingChild, null);
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
