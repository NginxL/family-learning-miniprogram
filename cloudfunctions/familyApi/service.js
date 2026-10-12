'use strict';
const crypto = require('node:crypto');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const dayKey = (familyId, date) => hash(`${familyId}:${date}`);
const chinaDate = (time) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);

class DomainError extends Error {
  constructor(code, message) { super(message); this.code = code; this.isDomainError = true; }
}
function requireValue(condition, code, message) {
  if (!condition) throw new DomainError(code, message);
}
function text(value, label, max = 40) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    'INVALID', `${label}不能为空，且不能超过${max}字`);
  return value.trim();
}
function identifier(value) {
  requireValue(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value), 'INVALID', '编号无效');
  return value;
}
function validDate(value, now) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID', '日期无效');
  const parsed = Date.parse(`${value}T00:00:00+08:00`);
  requireValue(Number.isFinite(parsed) && chinaDate(parsed) === value && value <= chinaDate(now), 'INVALID', '日期无效或尚未到达');
  requireValue(now - parsed <= 366 * 86400000, 'INVALID', '仅支持最近一年内的记录');
  return value;
}
function publicFamily(family, uid) {
  return {
    id: family.id, name: family.name, ownerId: family.ownerId,
    members: family.members.map(({ id, name, role }) => ({ id, name, role })),
    children: clone(family.children), plans: clone(family.plans),
    myRole: family.ownerId === uid ? 'owner' : 'guardian'
  };
}

function createService({ store, now = Date.now, randomId = () => crypto.randomBytes(16).toString('hex'),
  inviteCode = () => crypto.randomBytes(12).toString('hex').toUpperCase() }) {
  async function execute(openid, action, input = {}) {
    requireValue(typeof openid === 'string' && openid.length > 0, 'UNAUTHENTICATED', '请通过微信小程序进入');
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID', '请求内容无效');
    const uid = hash(openid);
    const timestamp = now();
    const today = chinaDate(timestamp);
    const newId = randomId();
    const code = action === 'createInvite' ? inviteCode() : null;

    return store.run(async (tx) => {
      const profile = await tx.get('profiles', uid);
      if (action === 'bootstrap') {
        const family = profile && profile.familyId ? await tx.get('families', profile.familyId) : null;
        const belongs = family && family.members.some((member) => member.id === uid);
        return { userId: uid, today, family: belongs ? publicFamily(family, uid) : null };
      }
      if (action === 'createFamily') {
        requireValue(!profile || !profile.familyId, 'ALREADY_JOINED', '你已加入一个家庭');
        const familyId = `f_${uid.slice(0, 32)}`;
        // Deterministic ownership makes a retried creation safe, including after a lost response.
        const existing = await tx.get('families', familyId);
        requireValue(!existing, 'ALREADY_JOINED', '家庭已创建，请刷新');
        const childId = `c_${newId}`;
        const family = {
          id: familyId, name: text(input.name, '家庭名称', 24), ownerId: uid,
          members: [{ id: uid, name: text(input.memberName, '你的称呼', 16), role: 'owner' }],
          children: [{ id: childId, name: text(input.childName, '孩子昵称', 16) }],
          plans: [
            { id: `p_${newId}_poem`, childId, title: '读一读《咏鹅》', subject: 'poetry', minutes: 5,
              detail: '骆宾王\n鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。\n\n和家人一起读，再用自己的话说说看到了什么。', source: '古诗文示例；未映射校内教材', enabled: true },
            { id: `p_${newId}_english`, childId, title: '用英语打个招呼', subject: 'english', minutes: 5,
              detail: 'Hello! 你好！\nGood morning! 早上好！\nMy name is ... 我的名字是……\n\n和家人轮流练习两次。', source: '自编入门示例；非教材单元', enabled: true }
          ],
          createdAt: timestamp, activeInviteHash: null
        };
        await tx.put('families', familyId, family);
        await tx.put('profiles', uid, { familyId });
        return { family: publicFamily(family, uid) };
      }
      if (action === 'joinFamily') {
        requireValue(!profile || !profile.familyId, 'ALREADY_JOINED', '你已加入一个家庭');
        const enteredCode = text(input.code, '邀请码', 32).replace(/\s/g, '').toUpperCase();
        requireValue(/^[A-F0-9]{24}$/.test(enteredCode), 'INVALID_INVITE', '邀请码无效');
        const inviteHash = hash(enteredCode);
        const invite = await tx.get('invites', inviteHash);
        requireValue(invite && !invite.usedAt && invite.expiresAt > timestamp, 'INVALID_INVITE', '邀请码无效、已使用或已过期');
        const family = await tx.get('families', invite.familyId);
        requireValue(family && family.activeInviteHash === inviteHash, 'INVALID_INVITE', '邀请码已失效');
        requireValue(family.members.length < 10, 'LIMIT', '一个家庭最多10位成员');
        family.members.push({ id: uid, name: text(input.memberName, '你的称呼', 16), role: 'guardian' });
        family.activeInviteHash = null;
        await tx.put('families', family.id, family);
        await tx.put('profiles', uid, { familyId: family.id });
        await tx.put('invites', inviteHash, { ...invite, usedAt: timestamp });
        return { family: publicFamily(family, uid) };
      }

      requireValue(profile && profile.familyId && profile.familyId === input.familyId, 'FORBIDDEN', '当前账号没有这个家庭的访问权限');
      const family = await tx.get('families', profile.familyId);
      requireValue(family && family.members.some((member) => member.id === uid), 'FORBIDDEN', '你已不在这个家庭中');
      const owner = () => requireValue(family.ownerId === uid, 'FORBIDDEN', '只有家庭创建者可以操作');
      const childExists = (childId) => requireValue(family.children.some((child) => child.id === childId), 'INVALID', '孩子档案不存在');

      if (action === 'createInvite') {
        owner();
        const inviteHash = hash(code);
        const expiresAt = timestamp + 24 * 3600000;
        family.activeInviteHash = inviteHash;
        await tx.put('invites', inviteHash, { familyId: family.id, expiresAt, usedAt: null });
        await tx.put('families', family.id, family);
        return { code, expiresAt };
      }
      if (action === 'removeMember' || action === 'leaveFamily') {
        const memberId = action === 'leaveFamily' ? uid : identifier(input.memberId);
        if (action === 'removeMember') owner();
        requireValue(memberId !== family.ownerId, 'INVALID', '创建者需要保留在家庭中');
        family.members = family.members.filter((member) => member.id !== memberId);
        const removedProfile = await tx.get('profiles', memberId);
        if (removedProfile && removedProfile.familyId === family.id) await tx.put('profiles', memberId, { familyId: null });
        await tx.put('families', family.id, family);
        return { removed: true };
      }
      if (action === 'addChild') {
        owner();
        requireValue(family.children.length < 5, 'LIMIT', '一个家庭最多5个孩子档案');
        family.children.push({ id: `c_${newId}`, name: text(input.name, '孩子昵称', 16) });
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'addPlan') {
        childExists(input.childId);
        requireValue(family.plans.length < 100, 'LIMIT', '最多保存100项学习计划');
        requireValue(['poetry', 'english', 'other'].includes(input.subject), 'INVALID', '请选择学习科目');
        requireValue(Number.isInteger(input.minutes) && input.minutes >= 1 && input.minutes <= 120, 'INVALID', '时长需为1–120分钟');
        family.plans.push({ id: `p_${newId}`, childId: input.childId, title: text(input.title, '任务名称', 60),
          detail: typeof input.detail === 'string' ? input.detail.trim().slice(0, 2000) : '',
          subject: input.subject, minutes: input.minutes, enabled: true, source: '家长自建' });
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'setPlanEnabled') {
        const plan = family.plans.find((item) => item.id === input.planId);
        requireValue(plan && typeof input.enabled === 'boolean', 'INVALID', '学习计划不存在或状态无效');
        plan.enabled = input.enabled;
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'getDay') {
        const date = validDate(input.date || today, timestamp);
        const id = dayKey(family.id, date);
        let day = await tx.get('days', id);
        const existed = Boolean(day);
        // Past days remain immutable snapshots of their actual assignments.
        if (date === today) {
          day = day || { familyId: family.id, date, tasks: [] };
          const known = new Set(day.tasks.map((task) => task.id));
          const added = family.plans.filter((plan) => plan.enabled && !known.has(plan.id));
          if (added.length || !existed) {
            day.tasks.push(...added.map((plan) => ({ ...clone(plan), done: false, version: 0, updatedBy: null, updatedAt: null })));
            await tx.put('days', id, day);
          }
        }
        return { day: day || { familyId: family.id, date, tasks: [] }, today };
      }
      if (action === 'setTaskDone') {
        const date = validDate(input.date, timestamp);
        identifier(input.taskId); identifier(input.mutationId);
        requireValue(typeof input.done === 'boolean' && Number.isInteger(input.baseVersion) && input.baseVersion >= 0, 'INVALID', '任务状态无效');
        const receiptId = hash(`${uid}:${input.mutationId}`);
        const fingerprint = hash(JSON.stringify([family.id, date, input.taskId, input.done, input.baseVersion]));
        const receipt = await tx.get('receipts', receiptId);
        if (receipt) {
          requireValue(receipt.fingerprint === fingerprint, 'INVALID', '操作编号已用于其他请求');
          return { task: receipt.task, duplicate: true };
        }
        const id = dayKey(family.id, date);
        const day = await tx.get('days', id);
        const task = day && day.tasks.find((item) => item.id === input.taskId);
        requireValue(task, 'NOT_FOUND', '当天没有这个任务，请刷新');
        requireValue(task.version === input.baseVersion, 'CONFLICT', '另一位家人已更新此任务，请查看最新状态后重新操作');
        task.done = input.done;
        task.version += 1;
        task.updatedAt = timestamp;
        task.updatedBy = uid;
        await tx.put('days', id, day);
        await tx.put('receipts', receiptId, { familyId: family.id, fingerprint, task: clone(task), createdAt: timestamp });
        return { task: clone(task), duplicate: false };
      }
      throw new DomainError('INVALID', '未知操作');
    });
  }
  return { execute };
}
module.exports = { createService, DomainError, chinaDate, dayKey };
