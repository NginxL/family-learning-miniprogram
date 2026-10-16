const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, memoryStorage } = require('./helpers');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const photo = Buffer.from([255, 216, 255, 224, 1, 2, 3]).toString('base64');
const recording = Buffer.from('ID3test-recording').toString('base64');
const date = '2026-10-12';
async function setup() {
  const files = new Map(); let uploads = 0;
  const f = fixture({ media: { async upload(path, data) { files.set(path, data); uploads++; return path; },
    async download(path) { return files.get(path); } } });
  const family = await f.family(); const childId = family.children[0].id;
  const invite = await f.call('parent-a', 'createInvite', { familyId: family.id, role: 'child', childId, guardianConsent: true });
  const joined = await f.call('child-a', 'joinFamily', { code: invite.code, memberName: '孩子' });
  await f.call('parent-a', 'getDay', { familyId: family.id, date });
  const scope = { familyId: family.id, childId, date, kind: 'poetry' };
  const call = (user, action, input = {}) => f.call(user, action, { ...scope, ...input });
  const upload = (id = 'photo1', input = {}) => call('child-a', 'uploadHomeworkAttachment', { uploadId: id, mime: 'image/jpeg', base64: photo, duration: 0, ...input });
  const submit = (attachmentId, baseVersion = 0, submissionId = 'submit1') => call('child-a', 'submitHomework', { attachmentIds: [attachmentId], baseVersion, submissionId });
  return { ...f, files, uploads: () => uploads, family, scope, call, upload, submit, invite, joined };
}
const code = (expected) => (error) => error.code === expected;

test('child invitation fixes the role and profile; ordinary invitations remain guardians', async () => {
  const f = await setup();
  assert.equal(f.joined.family.myRole, 'child'); assert.equal(f.joined.family.myChildId, f.scope.childId);
  await assert.rejects(f.call('outsider', 'joinFamily', { code: f.invite.code, memberName: '其他' }), code('INVALID_INVITE'));
  await assert.rejects(f.call('parent-a', 'createInvite', { role: 'child', guardianConsent: false }), code('INVALID'));
  const invitation = await f.call('parent-a', 'createInvite', { role: 'child', guardianConsent: true });
  const result = await f.call('child-b', 'joinFamily', { code: invitation.code, memberName: '孩子乙', role: 'owner', childId: 'forged' });
  assert.equal(result.family.myRole, 'child'); assert.equal(result.family.myChildId, f.scope.childId);
  await f.addParent(f.family.id); assert.equal((await f.call('parent-b', 'bootstrap')).family.myRole, 'guardian');
});

test('child cannot mutate through any old parent endpoint and cannot read a sibling', async () => {
  const f = await setup(); const added = await f.call('parent-a', 'addChild', { name: '另一个孩子' });
  const other = added.family.children[1].id;
  for (const action of ['setTaskDone', 'saveAutoPlans', 'addPlan', 'setPlanEnabled', 'setMastery', 'reviewContent', 'assignContent', 'createInvite', 'addChild', 'updateChild', 'removeMember', 'leaveFamily']) {
    await assert.rejects(f.call('child-a', action), code('PARENT_REQUIRED'), action);
  }
  for (const action of ['getHistory', 'getProgress', 'getHomework']) await assert.rejects(f.call('child-a', action, { childId: other }), code('FORBIDDEN'));
  const boot = await f.call('child-a', 'bootstrap'); assert.deepEqual(boot.family.children.map((c) => c.id), [f.scope.childId]);
  assert.deepEqual(Object.keys(boot.family.autoPlans), [f.scope.childId]);
  const { day } = await f.call('child-a', 'getDay'); assert.ok(day.tasks.every((t) => t.childId === f.scope.childId));
  const client = f.client('child-a'); await client.engine.sync(date);
  assert.throws(() => client.engine.enqueue(date, day.tasks[0].id, true), code('PARENT_REQUIRED'));
  await assert.rejects(client.engine.command('createInvite', {}), code('PARENT_REQUIRED'));
});

test('photo/audio submission, return, resubmit and parent approval synchronize completion and history', async () => {
  const f = await setup(); await f.addParent(f.family.id);
  const a = await f.upload(); const b = await f.upload('record1', { mime: 'audio/mpeg', base64: recording, duration: 5 });
  const pending = await f.call('child-a', 'submitHomework', { attachmentIds: [a.attachmentId, b.attachmentId], baseVersion: 0, submissionId: 'initial' });
  assert.equal(pending.homework.status, 'pending'); assert.equal(pending.homework.attachments.length, 2);
  assert.ok(!(await f.call('parent-a', 'getDay')).day.tasks.some((task) => task.done));
  assert.equal((await f.call('child-a', 'getHistory')).total, 0);
  assert.deepEqual((await f.call('child-a', 'getLearningStatus')).items, []);
  const received = await f.call('parent-b', 'getHomeworkAttachment', { attachmentId: b.attachmentId }); assert.equal(received.base64, recording);
  assert.ok(!JSON.stringify(pending).includes('fileId'));
  await assert.rejects(f.call('child-a', 'reviewHomework', { baseVersion: 1, decision: 'approve' }), code('PARENT_REQUIRED'));
  const returned = await f.call('parent-b', 'reviewHomework', { baseVersion: 1, decision: 'return', feedback: '再读一次最后一句' });
  assert.equal(returned.homework.status, 'returned'); assert.equal(returned.homework.feedback, '再读一次最后一句');
  const resubmit = await f.submit(a.attachmentId, 2, 'resubmit'); assert.equal(resubmit.homework.version, 3);
  const approved = await f.call('parent-a', 'reviewHomework', { baseVersion: 3, decision: 'approve' });
  assert.equal(approved.homework.status, 'approved');
  const tasks = (await f.call('child-a', 'getDay')).day.tasks;
  assert.ok(tasks.filter((t) => t.kind === 'poetry').every((t) => t.done));
  assert.ok(tasks.filter((t) => t.kind !== 'poetry').every((t) => !t.done));
  assert.equal((await f.call('child-a', 'getHistory')).total, 1);
  const client = f.client('parent-b'); await client.engine.sync(date);
  const task = tasks.find((t) => t.kind === 'poetry'); client.engine.enqueue(date, task.id, false); await client.engine.sync(date);
  assert.equal((await f.call('child-a', 'getHomework')).homework.status, 'returned');
  assert.equal((await f.call('child-a', 'getHistory')).total, 0);
  assert.deepEqual((await f.call('child-a', 'getLearningStatus')).items, []);
});

test('retry after lost upload/submit response is idempotent; stale reviewer cannot approve new work', async () => {
  const f = await setup(); const a = await f.upload(); assert.deepEqual(await f.upload(), a); assert.equal(f.uploads(), 1);
  const first = await f.submit(a.attachmentId); assert.deepEqual(await f.submit(a.attachmentId), first);
  await assert.rejects(f.upload('photo1', { base64: Buffer.from([255,216,255,0]).toString('base64') }), code('INVALID'));
  const resubmit = await f.submit(a.attachmentId, 1, 'second'); assert.equal(resubmit.homework.version, 2);
  await assert.rejects(f.call('parent-a', 'reviewHomework', { baseVersion: 1, decision: 'approve' }), code('CONFLICT'));
  assert.equal((await f.call('child-a', 'getHomework')).homework.status, 'pending');
});

test('unsubmitted files, siblings, strangers and removed members cannot download or attach media', async () => {
  const f = await setup();
  await f.call('parent-a', 'addPlan', { subject: 'english', kind: 'word', title: 'hello', minutes: 1, schedule: 'once' });
  await f.call('parent-a', 'getDay');
  const a = await f.upload();
  await assert.rejects(f.call('parent-a', 'getHomeworkAttachment', { attachmentId: a.attachmentId }), code('FORBIDDEN'));
  await f.submit(a.attachmentId);
  await assert.rejects(f.call('stranger', 'getHomeworkAttachment', { attachmentId: a.attachmentId }), code('FORBIDDEN'));
  await assert.rejects(f.call('child-a', 'submitHomework', { attachmentIds: [a.attachmentId], baseVersion: 0, submissionId: 'other-scope', kind: 'word' }), code('INVALID'));
  const childMember = f.joined.family.members.find((m) => m.role === 'child');
  await f.call('parent-a', 'removeMember', { memberId: childMember.id });
  for (const action of ['getHomework', 'getHomeworkAttachment', 'uploadHomeworkAttachment'])
    await assert.rejects(f.call('child-a', action, { attachmentId: a.attachmentId, uploadId: 'after-remove', mime: 'image/jpeg', base64: photo, duration: 0 }), code('FORBIDDEN'));
});

test('file validation, attachment count and task changes are enforced before approval', async () => {
  const f = await setup();
  for (const bad of [{ mime: 'text/html' }, { base64: 'bad!' }, { duration: 1 }, { base64: Buffer.alloc(512 * 1024 + 1).toString('base64') }, { mime: 'audio/mpeg', base64: recording, duration: 61 }])
    await assert.rejects(f.upload('invalid', bad), code('INVALID'));
  assert.equal(f.uploads(), 0);
  await assert.rejects(f.call('parent-a', 'uploadHomeworkAttachment', { uploadId: 'parent', mime: 'image/jpeg', base64: photo, duration: 0 }), code('CHILD_REQUIRED'));
  const a = await f.upload(); await assert.rejects(f.call('child-a', 'submitHomework', { attachmentIds: [a.attachmentId, a.attachmentId], baseVersion: 0, submissionId: 'dupe' }), code('INVALID'));
  await f.submit(a.attachmentId);
  await f.call('parent-a', 'addPlan', { subject: 'poetry', kind: 'poetry', title: '另一首诗', detail: '自建', minutes: 2, schedule: 'once' });
  await f.call('parent-a', 'getDay');
  await assert.rejects(f.call('parent-a', 'reviewHomework', { baseVersion: 1, decision: 'approve' }), code('CONFLICT'));
});

test('new child identity discards stale parent cache and offline completion queue', async () => {
  const f = await setup(); const parent = f.client('parent-a'); await parent.engine.sync(date);
  parent.engine.enqueue(date, parent.engine.viewDay(date).tasks[0].id, true);
  const storage = memoryStorage(); storage.write(parent.engine.snapshot());
  const child = new SyncEngine({ storage, transport: (action, payload) => f.call('child-a', action, payload) });
  await child.sync(date); assert.equal(child.state.family.myRole, 'child'); assert.equal(child.state.queue.length, 0);
  assert.ok(child.viewDay(date).tasks.every((task) => !task.done));
});

function page(engine, scope) {
  let definition; global.Page = (value) => { definition = value; };
  const file = require.resolve('../miniprogram/pages/homework/index'); delete require.cache[file]; require(file);
  global.getApp = () => ({ engine, mode: 'cloud' });
  const instance = { ...definition, data: structuredClone(definition.data), active: true, setData(value) { Object.assign(this.data, value); } };
  instance.onLoad(scope); instance.render(); return instance;
}

test('homework page submits only attachments, parent page confirms, and child refresh shows completion', async (t) => {
  const f = await setup(); const child = f.client('child-a'); const parent = f.client('parent-a');
  await child.engine.sync(date); await parent.engine.sync(date);
  global.wx = { showToast() {}, getFileSystemManager: () => ({ readFile(input) { input.success({ data: photo }); }, unlink() {} }) };
  t.after(() => { delete global.Page; delete global.getApp; delete global.wx; });
  const c = page(child.engine, f.scope); await c.refresh(); assert.equal(c.data.isChild, true);
  c.files = [{ id: 'page-photo', path: 'temp/photo.jpg', mime: 'image/jpeg', duration: 0 }]; c.render(); await c.submit();
  assert.equal(c.data.statusLabel, '待家长确认'); assert.equal(c.data.drafts.length, 0); assert.equal(c.data.done, false);
  const p = page(parent.engine, f.scope); await p.refresh(); assert.equal(p.data.isChild, false);
  await p.approve(); assert.equal(p.data.statusLabel, '家长已确认完成');
  await c.refresh(); c.render(); assert.equal(c.data.done, true); assert.equal(c.data.statusLabel, '家长已确认完成');
  c.onUnload(); p.onUnload();
});

test('hidden homework page ignores a late response and clears subscriptions', async (t) => {
  const f = await setup(); const child = f.client('child-a'); await child.engine.sync(date);
  global.wx = { getFileSystemManager: () => ({ unlink() {} }) };
  t.after(() => { delete global.Page; delete global.getApp; delete global.wx; });
  const c = page(child.engine, f.scope); let resolve;
  const original = child.engine.transport;
  child.engine.transport = (action, payload) => action === 'getHomework' ? new Promise((done) => { resolve = done; }) : original(action, payload);
  const refresh = c.refresh();
  while (!resolve) await new Promise((done) => setImmediate(done));
  c.onHide(); resolve({ homework: { status: 'approved' } }); await refresh;
  assert.equal(c.data.homework, null); assert.equal(c.active, false); c.onUnload();
});

test('photo access waits for native privacy consent; refusal and leaving the page cancel capture', async (t) => {
  const f = await setup(); const child = f.client('child-a'); await child.engine.sync(date);
  let captures = 0; let authorizations = 0;
  global.wx = {
    getPrivacySetting(input) { input.success({ needAuthorization: true }); },
    requirePrivacyAuthorize(input) { authorizations++; input.success(); },
    chooseMedia(input) { captures++; input.fail({ errMsg: 'cancel' }); },
    getFileSystemManager: () => ({ unlink() {} })
  };
  t.after(() => { delete global.Page; delete global.getApp; delete global.wx; });
  const c = page(child.engine, f.scope);
  for (const decision of ['decline', 'agree', 'hide']) {
    const pending = c.takePhoto();
    while (!c.data.privacyRequired) await new Promise((done) => setImmediate(done));
    assert.equal(c.data.busy, true);
    if (decision === 'agree') c.agreePrivacy(); else if (decision === 'hide') c.onHide(); else c.declinePrivacy();
    await pending; assert.equal(c.data.privacyRequired, false); assert.equal(c.data.busy, false);
    assert.equal(captures, decision === 'decline' ? 0 : 1);
  }
  assert.equal(authorizations, 1); c.onUnload();
});

test('recorder listeners remain single, cancelled recordings never reach a later page', () => {
  const file = require.resolve('../miniprogram/lib/homework-media'); delete require.cache[file];
  const listeners = {}; let registrations = 0; const output = [];
  global.wx = { getRecorderManager: () => ({ onStop(fn) { listeners.stop = fn; registrations++; }, onError(fn) { listeners.error = fn; registrations++; },
    onInterruptionBegin(fn) { listeners.interrupt = fn; }, start() {}, stop() {} }) };
  const { startRecording } = require(file);
  try {
    const first = startRecording(() => output.push('old'), () => output.push('error')); first.cancel();
    assert.throws(() => startRecording(() => {}, () => {}), /上一段录音/);
    listeners.stop({}); assert.deepEqual(output, []);
    const second = startRecording(() => output.push('new'), () => output.push('error')); second.stop(); listeners.stop({});
    assert.deepEqual(output, ['new']); assert.equal(registrations, 2);
  } finally { delete global.wx; delete require.cache[file]; }
});
