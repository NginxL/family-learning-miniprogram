const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { common } = require('../miniprogram/lib/page');

const visibleSubjects = ['all', 'poetry', 'english', 'reading'];
function library(engine) {
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/library/index');
  delete require.cache[file]; require(file);
  const frames = [];
  const page = { ...definition, engine, data: structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
      frames.push({ subjects: this.data.subjectOptions.map(item => item.id), selected: this.data.subjectFilter });
    } };
  return { page, frames };
}

test('library never paints removed subjects during cold entry, sync, child selection or re-entry', async t => {
  const f = fixture(), family = await f.family();
  await f.call('parent-a', 'addChild', { familyId: family.id, name: '第二个孩子' });
  const { engine } = f.client('parent-a');
  const app = { engine, mode: 'cloud', navigation: { subject: 'math' } };
  global.getApp = () => app;
  global.wx = { showToast() {} };
  const originalSetInterval = global.setInterval, originalClearInterval = global.clearInterval;
  global.setInterval = () => 1; global.clearInterval = () => {};
  t.after(() => {
    global.setInterval = originalSetInterval; global.clearInterval = originalClearInterval;
    delete global.Page; delete global.getApp; delete global.wx;
  });
  const { page, frames } = library(engine);
  t.after(() => page.onUnload());
  assert.deepEqual(page.data.subjectOptions.map(item => item.id), visibleSubjects, 'the native first frame must already exclude removed tabs');
  // Keep network completion under test control so the empty startup frame is observed.
  const sync = engine.sync.bind(engine); engine.sync = async () => {};
  page.onShow(); assert.equal(page.data.family, null);
  assert.equal(page.data.subjectFilter, 'all', 'legacy navigation must not select a removed tab');
  await sync('2026-10-12');
  assert.ok(page.data.family);
  await page.loadLearningStatus();
  page.selectSubject({ currentTarget: { dataset: { id: 'english' } } });
  assert.equal(page.data.subjectFilter, 'english');
  page.selectChild({ currentTarget: { dataset: { id: engine.state.family.children[1].id } } });
  engine.emit();
  page.onHide(); app.navigation.subject = 'other'; page.onShow();
  assert.equal(page.data.subjectFilter, 'all');
  assert.ok(frames.length > 10, 'inspect intermediate setData calls, not only the final page state');
  for (const [index, frame] of frames.entries()) {
    assert.deepEqual(frame.subjects, visibleSubjects, `render frame ${index}`);
    assert.ok(visibleSubjects.includes(frame.selected), `removed subject selected in frame ${index}`);
  }
});

test('subject restrictions are page-local and preserve legacy categories for other pages', () => {
  assert.deepEqual(common().data.subjectOptions.map(item => item.id), [...visibleSubjects, 'math', 'other']);
});
