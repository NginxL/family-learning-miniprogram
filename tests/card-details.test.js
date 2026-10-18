const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers');
const learning = require('../shared/learning');
const { decorate } = require('../miniprogram/lib/page');
const date = '2026-10-12';
const event = id => ({ currentTarget: { dataset: { id } } });
const root = path.resolve(__dirname, '../miniprogram');

function page(name, engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
}
function channel() {
  const listeners = new Map(), pending = new Map();
  return {
    on(name, callback) { listeners.set(name, callback); if (pending.has(name)) callback(pending.get(name)); },
    off(name) { listeners.delete(name); },
    emit(name, value) { pending.set(name, value); listeners.get(name)?.(value); },
    size: () => listeners.size
  };
}
async function setup(t) {
  const f = fixture(), family = await f.family(), childId = family.children[0].id;
  const a = f.client('parent-a'); await a.engine.sync(date);
  const navigations = [], tabs = [], toasts = [];
  global.getApp = () => ({ engine: a.engine, mode: 'cloud', navigation: {} });
  global.wx = { showToast: value => toasts.push(value.title), navigateTo(value) {
    const eventChannel = channel(); navigations.push({ ...value, eventChannel });
    value.success?.({ eventChannel }); value.complete?.();
  }, navigateBack(value) { value.fail(); }, switchTab(value) { tabs.push(value.url); } };
  t.after(() => { delete global.Page; delete global.wx; delete global.getApp; });
  function detail() {
    const navigation = navigations.at(-1);
    const instance = page('content', a.engine);
    instance.getOpenerEventChannel = () => navigation.eventChannel;
    instance.onLoad(Object.fromEntries(new URL(navigation.url, 'https://local.test').searchParams));
    instance.onShow(); t.after(() => instance.onUnload());
    return instance;
  }
  return { f, family, childId, a, navigations, tabs, toasts, detail };
}

test('all learning lists share one native card; its action slot consumes taps without opening the card', t => {
  let definition; global.Component = value => { definition = value; };
  const component = require.resolve('../miniprogram/components/learning-card/index'); delete require.cache[component]; require(component);
  t.after(() => { delete global.Component; });
  const events = [], instance = { ...definition.methods, triggerEvent: name => events.push(name) };
  instance.open(); instance.stopActionTap(); assert.deepEqual(events, ['open']);
  const template = fs.readFileSync(path.join(root, 'components/learning-card/index.wxml'), 'utf8');
  assert.match(template, /bindtap="open"/); assert.match(template, /catchtap="stopActionTap"/);
  assert.match(template, /<slot name="actions"/); assert.match(template, /aria-role="button"/);
  for (const name of ['today', 'plans', 'library', 'history']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, `pages/${name}/index.json`)));
    assert.equal(config.usingComponents['learning-card'], '/components/learning-card/index');
    const markup = fs.readFileSync(path.join(root, `pages/${name}/index.wxml`), 'utf8');
    assert.match(markup, /<learning-card[^>]+bindopen=/);
    assert.doesNotMatch(markup, /bindtap="(?:expandContent|togglePreview)"/);
  }
  const history = fs.readFileSync(path.join(root, 'pages/history/index.wxml'), 'utf8');
  assert.match(history, /catchtap="toggleMastery"/); assert.match(history, /catchtap="reviewToday"/);
  const library = fs.readFileSync(path.join(root, 'pages/library/index.wxml'), 'utf8');
  assert.match(library, /catchtap="assignItem"/);
});

test('library cards open full evidence, notes and pinyin; learned status remains scoped and no reading changes records', async t => {
  const { a, childId, detail, tabs, navigations } = await setup(t);
  const library = page('library', a.engine); library.render();
  const item = library.data.items.find(entry => entry.id === 'poem-goose');
  item.learnedLabel = '已掌握'; item.lastLearned = date; item.learnedCount = 2;
  const before = a.engine.snapshot();
  library.openContent(event(item.id)); const content = detail();
  assert.equal(content.data.item.id, item.id); assert.equal(content.data.item.detail, item.detail);
  assert.equal(content.data.item.subject, item.subject);
  assert.ok(content.data.item.poetryByline); assert.ok(content.data.item.recitationNote);
  assert.deepEqual(content.data.item.gradeMappings, learning.catalogById.get(item.id).gradeMappings);
  assert.equal(content.data.status, '已掌握'); assert.match(content.data.contextLabel, /2 天/);
  assert.ok(content.data.pinyin); assert.equal(content.data.showPinyin, library.data.showPinyin);
  content.togglePinyin(); assert.equal(content.data.showPinyin, !library.data.showPinyin);
  assert.equal(navigations.length, 1); assert.deepEqual(a.engine.snapshot(), before);
  content.goBack(); assert.deepEqual(tabs, ['/pages/library/index']);
  a.engine.state.family.id = 'different-family'; a.engine.emit();
  assert.equal(content.data.item.id, item.id, 'public knowledge stays readable');
  assert.equal(content.data.status, ''); assert.equal(content.data.contextLabel, '', 'old child progress is not exposed');
  content.onUnload(); assert.equal(navigations[0].eventChannel.size(), 0);
});

test('history opens its saved text offline instead of substituting catalogue text, and identity changes redact it', async t => {
  const { a, childId, detail, navigations } = await setup(t);
  const history = page('history', a.engine); history.render();
  const saved = { ...decorate(learning.catalogById.get('poem-goose')), contentId: 'poem-goose',
    detail: '当时保存的节选，不能用现版正文替换', source: '家长记录的资料', firstSeen: date, lastSeen: date, lastLearned: date,
    learnedCount: 1, mastered: false, version: 3 };
  history.setData({ childId, historyItems: [saved] }); a.offline();
  const before = a.engine.snapshot(); history.openContent(event(saved.contentId)); const content = detail();
  assert.equal(content.data.item.detail, saved.detail); assert.equal(content.data.item.displayDetail, saved.detail);
  assert.equal(content.data.item.source, saved.source); assert.equal(content.data.status, '已学过');
  assert.ok(!navigations[0].url.includes(saved.detail)); assert.deepEqual(a.engine.snapshot(), before);
  saved.detail = '列表随后变化'; assert.notEqual(content.data.item.detail, saved.detail, 'the detail owns a snapshot');
  a.engine.state.family.myRole = 'child'; a.engine.emit();
  assert.equal(content.data.item, null); assert.ok(content.data.pageError);
  assert.equal(content.data.contextLabel, '');
});

test('parent-added content uses the same detail page and retains text, source and schedule without changing the plan', async t => {
  const { f, family, childId, a, detail } = await setup(t);
  await f.call('parent-a', 'addPlan', { familyId: family.id, childId, title: '亲子阅读', detail: '读第 5–8 页，再讲给家人听。',
    kind: 'reading', subject: 'reading', minutes: 8, schedule: 'library' });
  await a.engine.sync(date);
  const plans = page('plans', a.engine); plans.render(); const plan = plans.data.plans[0];
  const before = a.engine.snapshot(); plans.openPlan(event(plan.id)); const content = detail();
  assert.equal(content.data.item.title, plan.title); assert.equal(content.data.item.detail, plan.detail);
  assert.equal(content.data.contextLabel, '自动内容库'); assert.equal(content.data.status, '已启用');
  assert.deepEqual(a.engine.snapshot(), before);
});

test('missing, mismatched or stale private detail entries do not guess content or another child’s history', async t => {
  const { a, family, childId } = await setup(t);
  for (const query of [{}, { source: 'library', id: 'not-found' }, { source: 'history', id: 'poem-goose' }]) {
    const content = page('content', a.engine); content.getOpenerEventChannel = () => ({}); content.onLoad(query); content.render();
    assert.equal(content.data.item, null); assert.ok(content.data.pageError);
  }
  const content = page('content', a.engine), eventChannel = channel();
  content.getOpenerEventChannel = () => eventChannel;
  content.onLoad({ source: 'history', id: 'poem-goose' });
  const payload = { source: 'history', item: decorate(learning.catalogById.get('poem-goose')), familyId: family.id,
    childId, role: 'owner', boundChild: '', userId: a.engine.state.userId, contextLabel: '旧家庭记录' };
  eventChannel.emit('showContent', { ...payload, item: { ...payload.item, id: 'not-this-content' } }); content.render();
  assert.equal(content.data.item, null);
  eventChannel.emit('showContent', { ...payload, childId: 'removed-child' }); content.render();
  assert.equal(content.data.item, null); assert.equal(content.data.contextLabel, '');
  content.onUnload();
});

test('future detail links retain the one-year limit and completion becomes available only on the task date', async t => {
  const { f, family, childId, a, navigations } = await setup(t);
  const study = page('study', a.engine);
  const route = { familyId: family.id, childId, date: '2027-10-13', kind: 'poetry', view: 'plan' };
  study.onLoad(route); study.render(); await study.toggleGroup(); assert.equal(study.data.group, null);
  assert.equal(a.engine.state.queue.length, 0);
  route.date = '2026-10-13'; await a.engine.sync(route.date); study.onLoad(route); study.render();
  assert.equal(study.data.planning, true); await study.toggleGroup(); study.openHomework();
  assert.equal(a.engine.state.queue.length, 0); assert.equal(navigations.length, 0);
  f.advance(86400000); await a.engine.sync(route.date); study.render();
  assert.equal(study.data.planning, false); assert.equal(study.data.date, route.date);
  study.editTask(event(study.data.items[0].id)); assert.equal(study.data.editTarget, null, 'arrived tasks cannot be deleted as future previews');
  await study.toggleGroup(); assert.equal(study.data.group.done, true);
});

test('returning to a detail page during a pending plan edit cannot submit the same edit twice', async t => {
  const { family, childId, a } = await setup(t);
  const tomorrow = '2026-10-13'; await a.engine.sync(tomorrow);
  const study = page('study', a.engine); study.onLoad({ familyId: family.id, childId, date: tomorrow, kind: 'poetry', view: 'plan' });
  study.render(); study.editTask(event(study.data.items[0].id));
  let finish, requests = 0;
  a.engine.command = async () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const pending = study.deleteTask(); assert.equal(study.data.busy, true);
  study.onHide(); study.onShow(); t.after(() => study.onUnload());
  assert.equal(study.data.busy, true); study.editTask(event(study.data.items[0].id)); await study.deleteTask();
  assert.equal(requests, 1);
  finish({ merged: false }); await pending; assert.equal(study.data.busy, false);
});

test('library detail schedules today, tomorrow and a selected date through the same scoped command without completing work', async t => {
  const { a, childId, detail, f, family, toasts } = await setup(t);
  const library = page('library', a.engine); library.render(); library.preferredDate = '2026-10-13';
  library.openContent(event('poem-goose')); const content = detail();
  assert.equal(content.data.canSchedule, true);
  const beforeQueue = structuredClone(a.engine.state.queue);
  for (const target of [date, '2026-10-13', '2026-10-25']) {
    content.arrangeContent();
    assert.equal(content.data.assignDate, '2026-10-13', 'the plan entry keeps its preferred date');
    assert.equal(content.data.assignTarget.childId, childId);
    content.changeAssignDate({ detail: { value: target } }); await content.confirmAssign();
    assert.equal(content.data.assignTarget, null);
    const result = await f.call('parent-a', 'getDay', { familyId: family.id, date: target });
    const tasks = result.day.tasks.filter(task => task.childId === childId && task.contentId === 'poem-goose');
    assert.equal(tasks.length, 1); assert.equal(tasks[0].done, false);
  }
  assert.equal(content.data.assignedToday, true); assert.deepEqual(a.engine.state.queue, beforeQueue);
  assert.equal(toasts.at(-1), '已加入2026-10-25');
  content.arrangeContent(); content.changeAssignDate({ detail: { value: '2026-10-25' } }); await content.confirmAssign();
  const remote = await f.call('parent-a', 'getDay', { familyId: family.id, date: '2026-10-25' });
  assert.equal(remote.day.tasks.filter(task => task.childId === childId && task.contentId === 'poem-goose').length, 1);
  assert.equal((await a.engine.getHistory({ childId })).total, 0, 'arranging and reading do not mark anything learned');
});

test('detail scheduling refuses invalid dates, child role, stale identity and a changed family', async t => {
  const { a, detail } = await setup(t); const library = page('library', a.engine); library.render();
  library.openContent(event('poem-goose')); const content = detail(); let commands = 0;
  a.engine.command = async () => { commands++; };
  for (const invalid of ['', '2026-02-30', '2026-10-11', '2027-10-13']) {
    content.arrangeContent(); content.changeAssignDate({ detail: { value: invalid } }); await content.confirmAssign();
  }
  assert.equal(commands, 0);
  content.arrangeContent(); a.engine.state.userId = 'another-parent'; await content.confirmAssign();
  assert.equal(content.data.assignTarget, null); assert.equal(commands, 0);
  content.render(); assert.equal(content.data.canSchedule, false); content.arrangeContent(); assert.equal(content.data.assignTarget, null);
  a.engine.state.family.myRole = 'child'; content.render(); assert.equal(content.data.canSchedule, false);
  a.engine.state.family.id = 'different-family'; content.render(); assert.equal(content.data.canSchedule, false);
  assert.ok(content.data.item, 'public content remains readable when its original child scope is lost');
});

test('pending scheduling cannot be submitted twice after returning and late results cannot reopen an old sheet', async t => {
  const { a, detail } = await setup(t); const library = page('library', a.engine); library.render();
  library.openContent(event('poem-goose')); const content = detail(); content.arrangeContent();
  let finish, commands = 0;
  a.engine.command = async () => { commands++; await new Promise(resolve => { finish = resolve; }); };
  const pending = content.confirmAssign(); content.onHide(); content.onShow();
  content.arrangeContent(); await content.confirmAssign();
  assert.equal(commands, 1); assert.equal(content.data.busy, true); assert.equal(content.data.assignTarget, null);
  finish(); await pending; assert.equal(content.data.busy, false); assert.equal(content.data.assignTarget, null);
});

test('provenance is disclosed separately while the body, dynasty, original edition labels and recitation scope remain available', async t => {
  const { a, detail } = await setup(t); const library = page('library', a.engine); library.render();
  library.openContent(event('poem-goose')); const content = detail();
  assert.equal(content.data.sourcesOpenId, ''); assert.doesNotMatch(content.data.gradeLabel, /核实|核对/);
  assert.match(content.data.item.note, /篇目、作者及选段已核对/);
  assert.equal(content.data.item.sourceMappings.length, content.data.item.gradeMappings.length);
  const before = a.engine.snapshot();
  content.toggleContentSources(event('poem-goose')); assert.equal(content.data.sourcesOpenId, 'poem-goose');
  content.toggleContentSources(event('poem-goose')); assert.equal(content.data.sourcesOpenId, '');
  assert.deepEqual(a.engine.snapshot(), before);
  const { withContentSources, learningGradeLabel } = require('../miniprogram/lib/content-presentation');
  const old = learning.catalog.find(item => item.gradeMappings?.some(mapping => mapping.editionStatus === 'historical_reference'));
  assert.match(learningGradeLabel(old), /旧版参考/);
  const recited = learning.catalog.find(item => item.recitationRequirements?.length);
  const display = withContentSources(decorate(recited));
  const requirement = recited.recitationRequirements[0];
  const mapping = recited.gradeMappings.find(m => m.bookId === requirement.bookId);
  assert.equal(display.recitationSummary, `${learning.gradeLabels[mapping.grade]}${mapping.semester}：${requirement.requirement}`);
  assert.doesNotMatch(display.recitationSummary, /原书第|电子第|核实|核对/);
  for (const name of ['study', 'content']) {
    const markup = fs.readFileSync(path.join(root, `pages/${name}/index.wxml`), 'utf8');
    assert.match(markup, /template is="contentSources"/);
    assert.doesNotMatch(markup, /\{\{item\.(?:note|recitationNote|dynastyNote|source)\}\}/);
  }
  const disclosure = fs.readFileSync(path.join(root, 'templates/content-sources.wxml'), 'utf8');
  assert.match(disclosure, /wx:if="\{\{sourcesOpenId === item.id\}\}"/);
  assert.match(disclosure, /\{\{item.note\}\}/); assert.match(disclosure, /\{\{mapping.evidence\}\}/);
});
