const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const { fixture } = require('./helpers');

const date = '2026-10-26';
function exhausted(kind = 'reading', quantity = 1, available = 0) {
  const rules = learning.emptyRules().map(rule => ({ ...rule, quantity: rule.kind === kind ? quantity : 0 }));
  const family = { children: [{ id: 'child' }], plans: [], templateSets: { child: {
    templates: [{ id: 'default', name: '每日积累', rules }], activeId: 'default', revision: 1
  } } };
  const ledger = { records: {} };
  for (const item of learning.materialPool(family, 'child', 'starter').filter(item => item.kind === kind).slice(available)) {
    ledger.records[item.id] = { item: { id: item.id, kind, builtin: true }, firstSeen: '2026-10-12', lastSeen: '2026-10-12',
      completedDates: [], mastered: false, version: 0 };
  }
  const day = { date, tasks: [] };
  learning.generateDay(family, day, { child: ledger });
  const addContent = id => family.plans.push({ id, childId: 'child', enabled: true, schedule: 'library', kind,
    subject: learning.definition(kind).subject, title: `自建内容 ${id}`, detail: `新内容正文 ${id}`, minutes: 1 });
  return { family, ledger, day, addContent };
}

test('saving unchanged rules fills an exhausted scope only after new eligible content is added', () => {
  const s = exhausted();
  const before = structuredClone(s.ledger);
  const warning = structuredClone(s.day.warnings);
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.equal(s.day.tasks.length, 0); // Neither repeat seen content nor silently expand the scope.
  assert.deepEqual(s.ledger, before);
  assert.deepEqual(s.day.warnings, warning);
  assert.equal(s.day.planRevision, undefined);
  s.addContent('new-reading');
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.deepEqual(s.day.tasks.map(task => task.contentId), ['new-reading']);
  assert.equal(s.day.generated.child.reading.actual, 1);
  assert.equal(s.day.warnings.length, 0);
  assert.equal(s.day.planRevision, 1);
  for (const [id, entry] of Object.entries(before.records)) assert.deepEqual(s.ledger.records[id], entry);
  const saved = structuredClone({ day: s.day, ledger: s.ledger });
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.deepEqual({ day: s.day, ledger: s.ledger }, saved);
});

test('unchanged-rule refill only appends and preserves completed, touched, manual and sibling tasks', () => {
  const s = exhausted('poetry', 3, 2);
  s.day.tasks[0] = { ...s.day.tasks[0], done: true, version: 1 };
  s.day.tasks[1] = { ...s.day.tasks[1], version: 2 };
  s.day.tasks.push(learning.taskFrom({ id: 'manual', kind: 'poetry', title: '家长另行安排', detail: '自建任务' }, 'child', 'manual', 'manual'));
  s.day.tasks.push(learning.taskFrom({ id: 'sibling', kind: 'poetry', title: '另一个孩子', detail: '单独任务' }, 'sibling', 'a_sibling', 'new'));
  learning.recordTasks(s.ledger, s.day.tasks.filter(task => task.childId === 'child'), date);
  const before = structuredClone({ tasks: s.day.tasks, records: s.ledger.records });
  s.addContent('new-poem');
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.equal(s.day.tasks.length, before.tasks.length + 1);
  for (const task of before.tasks) assert.deepEqual(s.day.tasks.find(item => item.id === task.id), task);
  for (const [id, entry] of Object.entries(before.records)) assert.deepEqual(s.ledger.records[id], entry);
  assert.equal(s.day.generated.child.poetry.actual, 3);
});

test('refill respects omitted slots and does not touch a submitted group', () => {
  const s = exhausted('poetry', 3, 2);
  const removed = s.day.tasks[0];
  learning.omitTask(s.day, removed);
  s.addContent('new-poem');
  s.addContent('unused-poem');
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.equal(s.day.tasks.length, 2); // Three requested minus one deliberately removed.
  assert.ok(!s.day.tasks.some(task => task.id === removed.id));
  assert.equal(s.day.generated.child.poetry.actual, 2);
  const stable = structuredClone(s.day);
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.deepEqual(s.day, stable);

  const submitted = exhausted();
  submitted.addContent('new-reading');
  const protectedDay = structuredClone(submitted.day);
  learning.replanTemplateDay(submitted.family, submitted.day, submitted.ledger, 'child', ['reading']);
  assert.deepEqual(submitted.day, protectedDay);
});

test('same-template refill requires applyToday and ignores future reserved or disabled content', async () => {
  const f = fixture(); const family = await f.family(); const childId = family.children[0].id;
  const call = (action, payload = {}) => f.call('parent-a', action, { familyId: family.id, childId, ...payload });
  let sequence = 0;
  const save = async applyToday => {
    const current = (await call('bootstrap')).family;
    const set = learning.templateSet(current, childId);
    return call('saveDailyTemplate', { templateId: set.activeId, name: '每日积累',
      rules: learning.emptyRules().map(rule => ({ ...rule, quantity: rule.kind === 'reading' ? 5 : 0 })),
      activate: false, baseRevision: set.revision, mutationId: `refill-${++sequence}`, ...(applyToday ? { applyToday: true } : {}) });
  };
  await save(true);
  assert.equal((await call('getDay')).day.tasks.filter(task => task.kind === 'reading').length, 5);
  f.advance(86400000);
  const before = (await call('getDay')).day;
  assert.equal(before.tasks.filter(task => task.kind === 'reading').length, 1);
  await call('addPlan', { kind: 'reading', subject: 'reading', title: '新增一篇', detail: '新增的短文', minutes: 1, schedule: 'library' });
  await save(false);
  assert.deepEqual((await call('getDay')).day.tasks, before.tasks);
  await save(true);
  const after = (await call('getDay')).day;
  assert.equal(after.tasks.filter(task => task.kind === 'reading').length, 2);
  assert.deepEqual(after.tasks.find(task => task.id === before.tasks[0].id), before.tasks[0]);

  const s = exhausted();
  const reserved = learning.materialPool(s.family, 'child', 'starter').find(item => item.kind === 'reading');
  delete s.ledger.records[reserved.id];
  s.family.scheduledContents = [{ childId: 'child', contentId: reserved.id, date: '2026-10-27' }];
  s.addContent('disabled'); s.family.plans.find(item => item.id === 'disabled').enabled = false;
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.equal(s.day.tasks.length, 0);
});

test('shortage messages name the selected scope, mode, quantity and actual automatic assignments', () => {
  const message = learning.ruleShortageMessage({ kind: 'poetry', mode: 'new', scope: 'starter', quantity: 1 }, 0);
  assert.match(message, /古诗文.*亲子入门.*全新.*计划 1首.*已安排 0首.*全新内容不足/);
  const review = learning.ruleShortageMessage({ kind: 'word', mode: 'review', scope: 'shanghai54', quantity: 5 }, 2);
  assert.match(review, /上海教材关联.*复习.*计划 5个.*已安排 2个.*已学内容不足/);
  const s = exhausted('poetry', 3, 2);
  learning.omitTask(s.day, s.day.tasks[0]);
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.equal(s.day.warnings.length, 1);
  assert.match(s.day.warnings[0].message, /计划 2首.*已安排 1首/);
});

test('append-only refill preserves legacy duplicates in other groups and does not inject manual plans', () => {
  const s = exhausted();
  const word = learning.materialPool(s.family, 'child', 'starter').find(item => item.kind === 'word');
  const sentence = learning.materialPool(s.family, 'child', 'starter').find(item => item.kind === 'sentence');
  const done = { ...learning.taskFrom(word, 'child', 'a_old_done', 'new'), done: true, version: 1 };
  s.day.tasks.push(done, learning.taskFrom(word, 'child', 'a_old_pending', 'new'),
    learning.taskFrom(sentence, 'child', 'a_duplicate_1', 'new'), learning.taskFrom(sentence, 'child', 'a_duplicate_2', 'new'));
  learning.recordTasks(s.ledger, s.day.tasks, date);
  s.family.plans.push({ id: 'scheduled-manual', childId: 'child', kind: 'reading', subject: 'reading', enabled: true,
    title: '指定日期的家长任务', detail: '模板保存不应注入此任务', schedule: 'once', date, minutes: 1 });
  s.addContent('new-reading');
  const before = structuredClone({ tasks: s.day.tasks, records: s.ledger.records });
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.deepEqual(s.day.tasks.slice(0, before.tasks.length), before.tasks);
  assert.deepEqual(s.day.tasks.slice(before.tasks.length).map(task => task.contentId), ['new-reading']);
  for (const [id, entry] of Object.entries(before.records)) assert.deepEqual(s.ledger.records[id], entry);
  assert.equal(s.ledger.records['scheduled-manual'], undefined);
});

test('mixed changed rules and refill preserve done/pending duplicate snapshots while counting them toward the target', () => {
  const s = exhausted('reading', 3, 1);
  s.day.tasks[0] = { ...s.day.tasks[0], done: true, version: 1 };
  s.day.tasks.push({ ...s.day.tasks[0], id: 'a_legacy_pending', done: false, version: 0 });
  learning.recordTasks(s.ledger, s.day.tasks, date);
  const original = structuredClone({ tasks: s.day.tasks, records: s.ledger.records });
  s.family.templateSets.child.templates[0].rules.find(rule => rule.kind === 'poetry').quantity = 1;
  s.addContent('new-reading');
  learning.replanTemplateDay(s.family, s.day, s.ledger, 'child');
  assert.deepEqual(s.day.tasks.slice(0, original.tasks.length), original.tasks);
  assert.equal(s.day.tasks.filter(task => task.kind === 'reading').length, 3);
  assert.equal(s.day.tasks.filter(task => task.kind === 'poetry').length, 1);
  assert.equal(s.day.generated.child.reading.actual, 3);
  for (const [id, entry] of Object.entries(original.records)) assert.deepEqual(s.ledger.records[id], entry);
});
