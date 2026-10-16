const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const learning = require('../shared/learning');
const DATE = '2026-10-12';
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
async function setup() {
  const f = fixture(); const family = await f.family();
  const familyId = family.id; const childId = family.children[0].id;
  const call = (action, payload = {}, user = 'parent-a') => f.call(user, action, { familyId, childId, ...payload });
  const rules = (values) => learning.emptyRules().map((rule) => ({ ...rule, ...(values[rule.kind] || {}) }));
  const configure = (values) => call('saveAutoPlans', { rules: rules(values) });
  let mutation = 0;
  const done = (task, date = DATE, value = true) => call('setTaskDone', { taskId: task.id, date, done: value, baseVersion: task.version, mutationId: `learn${++mutation}` });
  return { f, familyId, childId, call, rules, configure, done };
}

test('automatic daily quotas cover poems, English words/sentences, reading and maths; concurrent reads freeze one allocation', async () => {
  const s = await setup(); await s.f.addParent(s.familyId);
  const quantities = { poetry: 2, word: 5, sentence: 2, reading: 1, math: 3 };
  await s.configure(Object.fromEntries(Object.entries(quantities).map(([kind, quantity]) => [kind, { quantity }])));
  const [a, b] = await Promise.all([s.call('getDay'), s.call('getDay', {}, 'parent-b')]);
  assert.deepEqual(a.day, b.day);
  for (const [kind, count] of Object.entries(quantities)) assert.equal(a.day.tasks.filter((task) => task.kind === kind).length, count);
  assert.equal(new Set(a.day.tasks.map((task) => task.contentId)).size, 13);
  s.f.advance(86400000);
  const tomorrow = (await s.call('getDay')).day;
  assert.equal(tomorrow.tasks.some((task) => a.day.tasks.some((old) => old.contentId === task.contentId)), false, 'even uncompleted assignments are not new again');
});

test('English articles have their own plan type and new/review quotas without relabeling other reading content', async () => {
  const s = await setup();
  // Once built-in beginner texts have been seen, the same queue reaches a parent's own library.
  await s.configure({ 'english-reading': { quantity: 5 } });
  const builtinCount = learning.catalog.filter((item) => item.kind === 'english-reading').length;
  for (let i = 0; i < Math.ceil(builtinCount / 5); i++) { await s.call('getDay'); s.f.advance(86400000); }
  for (const [title, detail] of [['A red ball', 'I have a red ball.'], ['My little dog', 'My little dog runs to me.']]) {
    await s.call('addPlan', { title, detail, kind: 'english-reading', subject: 'english', minutes: 5, schedule: 'library' });
  }
  await s.configure({ 'english-reading': { quantity: 1 }, reading: { quantity: 1 }, word: { quantity: 2 } });
  const today = (await s.call('getDay')).day;
  const article = today.tasks.find((task) => task.kind === 'english-reading');
  assert.equal(article.subject, 'english'); assert.equal(article.source, '家长自建');
  assert.equal(today.tasks.filter((task) => task.kind === 'reading' && task.subject === 'reading').length, 1);
  assert.equal(today.tasks.filter((task) => task.kind === 'word').length, 2);
  await s.done(article, today.date); s.f.advance(86400000);
  const tomorrow = (await s.call('getDay')).day.tasks.find((task) => task.kind === 'english-reading');
  assert.notEqual(tomorrow.contentId, article.contentId);
  await s.configure({ 'english-reading': { quantity: 1, mode: 'review' } }); s.f.advance(86400000);
  const review = (await s.call('getDay')).day.tasks;
  assert.equal(review.length, 1); assert.equal(review[0].contentId, article.contentId); assert.equal(review[0].mode, 'review');
});

test('review uses completed content, oldest last-study date first; unfinished and other child content are excluded', async () => {
  const s = await setup(); await s.configure({ poetry: { quantity: 2 } });
  const first = (await s.call('getDay')).day.tasks;
  await s.done(first[0]);
  s.f.advance(86400000);
  const second = (await s.call('getDay')).day.tasks;
  await s.done(second[0], '2026-10-13');
  await s.configure({ poetry: { quantity: 2, mode: 'review' } });
  s.f.advance(86400000);
  const review = (await s.call('getDay')).day.tasks;
  assert.deepEqual(review.map((task) => task.contentId), [first[0].contentId, second[0].contentId]);
  assert.ok(review.every((task) => task.mode === 'review'));
  assert.equal(review.some((task) => task.contentId === first[1].contentId), false);
});

test('exhausted new pool and empty review pool show an explicit shortage instead of repeating or substituting', async () => {
  const s = await setup(); await s.configure({ reading: { quantity: 5 }, word: { quantity: 3, mode: 'review' } });
  const a = (await s.call('getDay')).day;
  assert.equal(a.tasks.length, 5); assert.match(a.warnings[0].message, /可复习内容不足/);
  s.f.advance(86400000);
  const b = (await s.call('getDay')).day;
  assert.equal(b.tasks.length, 1); assert.ok(b.warnings.some((entry) => /全新内容不足/.test(entry.message)));
  s.f.advance(86400000);
  assert.equal((await s.call('getDay')).day.tasks.length, 0);
});

test('plan edits preserve generated tasks today and apply tomorrow; newly enabled types can start today', async () => {
  const s = await setup(); await s.configure({ poetry: { quantity: 1 } });
  const original = (await s.call('getDay')).day.tasks[0]; await s.done(original);
  await s.configure({ poetry: { quantity: 3, mode: 'review' }, math: { quantity: 2 } });
  const updated = (await s.call('getDay')).day;
  assert.equal(updated.tasks.filter((task) => task.kind === 'poetry').length, 1);
  assert.equal(updated.tasks.find((task) => task.id === original.id).done, true);
  assert.equal(updated.tasks.filter((task) => task.kind === 'math').length, 2);
  s.f.advance(86400000);
  const tomorrow = (await s.call('getDay')).day;
  assert.equal(tomorrow.tasks.find((task) => task.kind === 'poetry').mode, 'review');
  assert.equal(tomorrow.generated[s.childId].poetry.quantity, 3);
});

test('parent-created once, daily and library content use the same task/history flow', async () => {
  const s = await setup(); await s.configure({});
  for (const [title, schedule] of [['阅读绘本 1–3 页', 'once'], ['讲一个故事', 'daily'], ['图书馆里的故事', 'library']]) {
    await s.call('addPlan', { title, schedule, kind: 'reading', subject: 'reading', minutes: 8, detail: '读完说说主要内容' });
  }
  const today = (await s.call('getDay')).day.tasks;
  assert.deepEqual(today.map((item) => item.title), ['阅读绘本 1–3 页', '讲一个故事']);
  await s.done(today[0]);
  assert.equal((await s.call('getHistory')).items[0].title, '阅读绘本 1–3 页');
  // Exhausting seed reading content also reaches the parent's library entry.
  await s.configure({ reading: { quantity: 5 } });
  await s.call('getDay'); s.f.advance(86400000);
  const tomorrow = (await s.call('getDay')).day.tasks;
  assert.equal(tomorrow.some((task) => task.title === '阅读绘本 1–3 页'), false);
  assert.equal(tomorrow.some((task) => task.title === '讲一个故事'), true);
  assert.equal(tomorrow.some((task) => task.title === '图书馆里的故事'), true);
});

test('a parent-added existing poem and an old starter poem do not become new again', async () => {
  const s = await setup(); await s.configure({});
  await s.call('addPlan', { title: '读一读《咏鹅》', subject: 'poetry', minutes: 5, schedule: 'once' });
  const first = (await s.call('getDay')).day.tasks[0]; assert.notEqual(first.contentId, 'poem-goose'); assert.equal(first.workId, 'poem-goose');
  await s.configure({ poetry: { quantity: 1 } }); s.f.advance(86400000);
  assert.equal((await s.call('getDay')).day.tasks[0].contentId, 'poem-quiet-night');
});

test('learned and mastered are distinct; mastery changes are versioned and undo removes only the corresponding learning date', async () => {
  const s = await setup(); await s.configure({ poetry: { quantity: 1 } });
  const original = (await s.call('getDay')).day.tasks[0];
  assert.equal((await s.call('getHistory')).items.length, 0);
  const payload = { contentId: original.contentId, mastered: true, baseVersion: 0 };
  await rejects(s.call('setMastery', payload), 'INVALID');
  const completed = (await s.done(original)).task;
  let item = (await s.call('getHistory')).items[0]; assert.equal(item.mastered, false);
  await s.call('setMastery', { ...payload, baseVersion: item.version });
  await rejects(s.call('setMastery', { ...payload, baseVersion: item.version }), 'CONFLICT');
  await s.configure({ poetry: { quantity: 1, mode: 'review' } }); s.f.advance(86400000);
  const review = (await s.call('getDay')).day.tasks[0]; const doneReview = (await s.done(review, '2026-10-13')).task;
  item = (await s.call('getHistory', { filter: 'mastered' })).items[0]; assert.equal(item.learnedCount, 2);
  await s.done(doneReview, '2026-10-13', false);
  item = (await s.call('getHistory')).items[0]; assert.equal(item.lastLearned, DATE); assert.equal(item.learnedCount, 1);
  await s.done(completed, DATE, false);
  assert.equal((await s.call('getHistory', { filter: 'mastered' })).total, 0);
  assert.equal((await s.call('getHistory')).total, 0);
  assert.equal((await s.call('getHistory', { filter: 'all' })).total, 1);
});

test('review from history joins today once and shares the same content identity', async () => {
  const s = await setup(); await s.configure({ poetry: { quantity: 1 } });
  const original = (await s.call('getDay')).day.tasks[0]; await s.done(original);
  await s.configure({}); s.f.advance(86400000);
  const payload = { contentId: original.contentId };
  const a = await s.call('reviewContent', payload); const b = await s.call('reviewContent', payload);
  assert.equal(a.task.id, b.task.id); assert.equal(a.task.mode, 'review');
  assert.equal((await s.call('getDay')).day.tasks.length, 1);
});

test('history pagination, subject filtering and search operate across dates; second child has an independent new pool', async () => {
  const s = await setup(); await s.configure({ word: { quantity: 30 } });
  const a = (await s.call('getDay')).day.tasks; for (const task of a) await s.done(task);
  s.f.advance(86400000);
  const b = (await s.call('getDay')).day.tasks; for (const task of b) await s.done(task, '2026-10-13');
  const first = await s.call('getHistory', { subject: 'english' });
  const second = await s.call('getHistory', { subject: 'english', offset: first.nextOffset });
  assert.equal(first.total, 60); assert.equal(first.items.length, 30); assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 60);
  assert.equal((await s.call('getHistory', { query: 'APPLE' })).items[0].title, 'apple');
  assert.equal((await s.call('getHistory', { subject: 'poetry' })).total, 0);
  const added = await s.call('addChild', { name: '小芽' }); const childId = added.family.children[1].id;
  await s.call('saveAutoPlans', { childId, rules: s.rules({ word: { quantity: 1 } }) });
  const task = (await s.call('getDay')).day.tasks.find((item) => item.childId === childId);
  assert.equal(task.title, 'hello'); assert.equal((await s.call('getHistory', { childId })).total, 0);
});

test('learning API validates quantities, modes, types and membership before reads or changes', async () => {
  const s = await setup();
  for (const rule of [{ quantity: -1 }, { quantity: 6 }, { quantity: 1.5 }, { mode: 'random' }]) await rejects(s.configure({ poetry: rule }), 'INVALID');
  await rejects(s.call('saveAutoPlans', { rules: [] }), 'INVALID');
  await rejects(s.call('getHistory', { childId: 'other-child' }), 'INVALID');
  await rejects(s.call('getHistory', { offset: -1 }), 'INVALID');
  await rejects(s.call('addPlan', { kind: 'word', subject: 'math', title: 'bad', minutes: 5 }), 'INVALID');
  for (const action of ['getHistory', 'saveAutoPlans', 'reviewContent', 'setMastery']) await rejects(s.call(action, {}, 'outsider'), 'FORBIDDEN');
});
