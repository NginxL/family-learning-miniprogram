const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const learning = require('../shared/learning');
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const DATE = '2026-10-12';

test('age and current school grade are optional, validated and synchronized with versioned profile edits', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const child = family.children[0]; assert.equal(child.age, null); assert.equal(child.schoolGrade, null);
  const payload = { familyId: family.id, childId: child.id, name: child.name, age: 6, schoolGrade: 1, baseVersion: 0 };
  await rejects(f.call('parent-b', 'updateChild', payload), 'FORBIDDEN');
  for (const age of [0, 19, 6.5, '6']) await rejects(f.call('parent-a', 'updateChild', { ...payload, age }), 'INVALID');
  await rejects(f.call('parent-a', 'updateChild', { ...payload, schoolGrade: 10 }), 'INVALID');
  await f.call('parent-a', 'updateChild', payload);
  await rejects(f.call('parent-a', 'updateChild', payload), 'CONFLICT');
  const updated = (await f.call('parent-b', 'bootstrap')).family.children[0];
  assert.deepEqual({ age: updated.age, schoolGrade: updated.schoolGrade, version: updated.version, date: updated.ageRecordedOn },
    { age: 6, schoolGrade: 1, version: 1, date: DATE });
  await rejects(f.call('outsider', 'getProgress', { familyId: family.id, childId: child.id }), 'FORBIDDEN');
  await rejects(f.call('parent-a', 'getProgress', { familyId: family.id, childId: 'another-child' }), 'INVALID');
});

test('library assignment is idempotent and respects scope, family isolation and completed versus mastered progress', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const base = { familyId: family.id, childId: family.children[0].id };
  const call = (action, payload = {}) => f.call('parent-a', action, { ...base, ...payload });
  await call('saveAutoPlans', { rules: learning.emptyRules() });
  await rejects(call('saveAutoPlans', { rules: learning.emptyRules().map((rule) => ({ ...rule, scope: 'invented' })) }), 'INVALID');
  await rejects(call('assignContent', { contentId: 'invented' }), 'INVALID');
  await rejects(f.call('outsider', 'assignContent', { ...base, contentId: 'sh54-jiande' }), 'FORBIDDEN');
  const a = await call('assignContent', { contentId: 'sh54-jiande' });
  const b = await f.call('parent-b', 'assignContent', { ...base, contentId: 'sh54-jiande' });
  assert.deepEqual(a.task, b.task); assert.equal((await call('getDay')).day.tasks.length, 1);
  assert.equal((await call('getProgress')).highestGradeStarted, 0, 'assignment alone is not learning');
  const { task } = await call('setTaskDone', { taskId: a.task.id, date: DATE, done: true, baseVersion: 0, mutationId: 'progress_done' });
  let progress = await call('getProgress');
  assert.equal(progress.highestGradeStarted, 6); assert.equal(progress.grades[5].learned, 1); assert.equal(progress.grades[5].mastered, 0);
  const history = await call('getHistory');
  await call('setMastery', { contentId: a.task.contentId, baseVersion: history.items[0].version, mastered: true });
  progress = await call('getProgress'); assert.equal(progress.grades[5].mastered, 1); assert.equal(progress.grades[5].fullGradeComplete, false);
  await call('setTaskDone', { taskId: task.id, date: DATE, done: false, baseVersion: task.version, mutationId: 'progress_undo' });
  progress = await call('getProgress'); assert.equal(progress.highestGradeStarted, 0); assert.equal(progress.stats.mastered, 0);
});

test('parent-labelled third-grade work is recorded independently of current grade and official textbook coverage', async () => {
  const f = fixture(); const family = await f.family(); const child = family.children[0];
  const base = { familyId: family.id, childId: child.id };
  const call = (action, payload = {}) => f.call('parent-a', action, { ...base, ...payload });
  await call('updateChild', { name: child.name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await call('saveAutoPlans', { rules: learning.emptyRules() });
  await call('addPlan', { kind: 'reading', subject: 'reading', title: '自选三年级阅读', detail: '讲述故事经过', minutes: 10, schedule: 'once', studyGrade: 3 });
  const task = (await call('getDay')).day.tasks[0];
  await call('setTaskDone', { taskId: task.id, date: DATE, done: true, baseVersion: task.version, mutationId: 'third_grade' });
  const progress = await call('getProgress');
  assert.equal(progress.grades[2].parentLearned, 1); assert.equal(progress.grades[2].learned, 0);
  assert.equal(progress.grades[2].coverage, 'partial'); assert.equal(progress.highestGradeStarted, 0);
  assert.equal((await f.call('parent-a', 'bootstrap')).family.children[0].schoolGrade, 1);
  const next = (await call('addChild', { name: '小芽' })).family.children[1];
  assert.equal((await call('getProgress', { childId: next.id })).stats.learned, 0);
});

test('a first-grade child can complete a verified third-grade textbook item without changing their school grade', async () => {
  const f = fixture(); const family = await f.family(); const child = family.children[0];
  const call = (action, payload = {}) => f.call('parent-a', action, { familyId: family.id, childId: child.id, ...payload });
  await call('updateChild', { name: child.name, age: 6, schoolGrade: 1, baseVersion: 0 });
  await call('saveAutoPlans', { rules: learning.emptyRules() });
  const assigned = await call('assignContent', { contentId: 'sh54-night-reading' });
  await call('setTaskDone', { taskId: assigned.task.id, date: DATE, done: true, baseVersion: 0, mutationId: 'verified_grade3' });
  const progress = await call('getProgress');
  assert.equal(progress.highestGradeStarted, 3); assert.equal(progress.grades[2].learned, 1);
  assert.equal(progress.grades[2].mastered, 0); assert.equal(progress.grades[2].parentLearned, 0);
  assert.equal(progress.grades[2].fullGradeComplete, false);
  const profile = (await f.call('parent-a', 'bootstrap')).family.children[0];
  assert.equal(profile.schoolGrade, 1); assert.equal(profile.age, 6);
});

test('a parent exercise sharing a textbook title cannot acquire its official grade mapping or hide the actual library work', async () => {
  const f = fixture(); const family = await f.family(); const child = family.children[0];
  const call = (action, payload = {}) => f.call('parent-a', action, { familyId: family.id, childId: child.id, ...payload });
  await call('saveAutoPlans', { rules: learning.emptyRules() });
  await call('addPlan', { kind: 'poetry', subject: 'poetry', title: '《夜书所见》', detail: '只认识标题中的一个字', minutes: 1, schedule: 'once', studyGrade: 1 });
  const task = (await call('getDay')).day.tasks[0];
  assert.notEqual(task.contentId, 'sh54-night-reading');
  await call('setTaskDone', { taskId: task.id, date: DATE, done: true, baseVersion: 0, mutationId: 'parent_title_only' });
  const progress = await call('getProgress');
  assert.equal(progress.highestGradeStarted, 0); assert.equal(progress.grades[2].learned, 0); assert.equal(progress.grades[0].parentLearned, 1);
  const assigned = await call('assignContent', { contentId: 'sh54-night-reading' });
  assert.notEqual(assigned.task.id, task.id); assert.equal(assigned.task.done, false);
});
