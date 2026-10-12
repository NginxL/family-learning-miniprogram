'use strict';
const crypto = require('node:crypto');
const learning = require('./learning/learning');
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
function childProfile(input, today) {
  const age = input.age === undefined || input.age === null ? null : input.age;
  const schoolGrade = input.schoolGrade === undefined || input.schoolGrade === null ? null : input.schoolGrade;
  requireValue(age === null || (Number.isInteger(age) && age >= 1 && age <= 18), 'INVALID', '年龄需为1–18岁，或留空');
  requireValue(schoolGrade === null || (Number.isInteger(schoolGrade) && schoolGrade >= 1 && schoolGrade <= 9), 'INVALID', '在读年级需为1–9，或留空');
  return { age, schoolGrade, ageRecordedOn: age === null ? null : today };
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
    children: clone(family.children), plans: clone(family.plans), autoPlans: clone(family.autoPlans || {}),
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
          children: [{ id: childId, name: text(input.childName, '孩子昵称', 16), ...childProfile(input, today), version: 0 }],
          plans: [], autoPlans: { [childId]: learning.defaultRules() },
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
      const ledgerKey = (childId) => hash(`${family.id}:${childId}`);
      const readLedger = async (childId) => (await tx.get('learning', ledgerKey(childId))) || { familyId: family.id, childId, records: {} };
      const saveLedger = async (ledger) => {
        // Leave headroom below the CloudBase document limit; fail atomically instead of dropping history.
        requireValue(Buffer.byteLength(JSON.stringify(ledger), 'utf8') < 700 * 1024, 'LIMIT', '学习档案容量已满，请联系管理员扩容后重试');
        await tx.put('learning', ledgerKey(ledger.childId), ledger);
      };
      const saveDay = async (id, day) => {
        requireValue(Buffer.byteLength(JSON.stringify(day), 'utf8') < 700 * 1024, 'LIMIT', '当天任务较多，请减少安排后重试');
        await tx.put('days', id, day);
      };

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
        family.children.push({ id: `c_${newId}`, name: text(input.name, '孩子昵称', 16), ...childProfile(input, today), version: 0 });
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'updateChild') {
        owner(); childExists(input.childId);
        const child = family.children.find((item) => item.id === input.childId);
        requireValue(Number.isInteger(input.baseVersion) && input.baseVersion === (child.version || 0), 'CONFLICT', '档案已更新，请刷新后再修改');
        Object.assign(child, { name: text(input.name, '孩子昵称', 16), ...childProfile(input, today), version: (child.version || 0) + 1 });
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'addPlan') {
        childExists(input.childId);
        requireValue(family.plans.length < 100, 'LIMIT', '最多保存100项学习计划');
        requireValue(['poetry', 'english', 'reading', 'math', 'other'].includes(input.subject), 'INVALID', '请选择学习科目');
        const kind = input.kind || learning.kindOf(input);
        requireValue(learning.kinds.some((item) => item.id === kind && item.subject === input.subject), 'INVALID', '学习类型与科目不匹配');
        const schedule = input.schedule || 'daily';
        requireValue(['once', 'daily', 'library'].includes(schedule), 'INVALID', '请选择安排方式');
        requireValue(Number.isInteger(input.minutes) && input.minutes >= 1 && input.minutes <= 120, 'INVALID', '时长需为1–120分钟');
        requireValue(input.studyGrade === undefined || input.studyGrade === null || (Number.isInteger(input.studyGrade) && input.studyGrade >= 1 && input.studyGrade <= 9), 'INVALID', '学习年级无效');
        family.plans.push({ id: `p_${newId}`, childId: input.childId, title: text(input.title, '任务名称', 60),
          detail: typeof input.detail === 'string' ? input.detail.trim().slice(0, 2000) : '',
          subject: input.subject, kind, schedule, date: today, minutes: input.minutes, enabled: true, source: '家长自建',
          ...(input.studyGrade ? { studyGrade: input.studyGrade } : {}) });
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
      if (action === 'saveAutoPlans') {
        childExists(input.childId);
        requireValue(Array.isArray(input.rules) && input.rules.length === learning.kinds.length, 'INVALID', '请提供完整的每日安排');
        const seen = new Set();
        const rules = input.rules.map((rule) => {
          requireValue(rule && typeof rule === 'object', 'INVALID', '每日安排无效');
          const kind = learning.kinds.find((item) => item.id === rule.kind);
          requireValue(kind && !seen.has(kind.id) && ['new', 'review'].includes(rule.mode)
            && Number.isInteger(rule.quantity) && rule.quantity >= 0 && rule.quantity <= kind.max, 'INVALID', '每日数量或新学／复习类型无效');
          const scope = rule.scope || 'starter';
          requireValue(learning.scopeOptions(kind.id).some((item) => item.id === scope), 'INVALID', '学习内容范围无效');
          seen.add(kind.id); return { kind: kind.id, mode: rule.mode, quantity: rule.quantity, scope };
        });
        family.autoPlans = family.autoPlans || {};
        family.autoPlans[input.childId] = rules;
        await tx.put('families', family.id, family);
        return { family: publicFamily(family, uid) };
      }
      if (action === 'getDay') {
        const date = validDate(input.date || today, timestamp);
        const id = dayKey(family.id, date);
        let day = await tx.get('days', id);
        const beforeDay = JSON.stringify(day);
        const ledgers = {};
        const originals = {};
        for (const child of family.children) {
          ledgers[child.id] = await readLedger(child.id);
          originals[child.id] = JSON.stringify(ledgers[child.id]);
        }
        // Old assignments are indexed when viewed, but no past tasks are invented.
        if (date === today) {
          day = day || { familyId: family.id, date, tasks: [] };
          learning.generateDay(family, day, ledgers);
          if (JSON.stringify(day) !== beforeDay) await saveDay(id, day);
        } else if (day) {
          for (const child of family.children) learning.recordTasks(ledgers[child.id], day.tasks.filter((task) => task.childId === child.id), date);
        }
        for (const child of family.children) if (originals[child.id] !== JSON.stringify(ledgers[child.id])) await saveLedger(ledgers[child.id]);
        return { day: day || { familyId: family.id, date, tasks: [] }, today };
      }
      if (action === 'getHistory') {
        childExists(input.childId);
        requireValue(input.subject === undefined || learning.subjects.some((item) => item.id === input.subject), 'INVALID', '科目无效');
        requireValue(input.filter === undefined || ['all', 'learned', 'mastered'].includes(input.filter), 'INVALID', '回顾范围无效');
        requireValue(input.query === undefined || (typeof input.query === 'string' && input.query.length <= 80), 'INVALID', '搜索内容过长');
        requireValue(input.offset === undefined || (Number.isInteger(input.offset) && input.offset >= 0 && input.offset <= 100000), 'INVALID', '分页无效');
        return learning.history(await readLedger(input.childId), input);
      }
      if (action === 'getProgress') {
        childExists(input.childId);
        return learning.progress(await readLedger(input.childId));
      }
      if (action === 'setMastery' || action === 'reviewContent' || action === 'assignContent') {
        childExists(input.childId); identifier(input.contentId);
        const ledger = await readLedger(input.childId);
        const entry = Object.hasOwn(ledger.records, input.contentId) ? ledger.records[input.contentId] : null;
        const candidate = learning.catalogById.get(input.contentId);
        if (action === 'assignContent') requireValue(candidate, 'INVALID', '知识库中没有这项内容，请更新小程序后重试');
        else requireValue(entry && entry.completedDates.length, 'INVALID', '请先完成这项内容的学习');
        if (action === 'setMastery') {
          requireValue(typeof input.mastered === 'boolean' && Number.isInteger(input.baseVersion), 'INVALID', '掌握状态无效');
          requireValue(entry.version === input.baseVersion, 'CONFLICT', '家人已更新学习记录，请刷新后再确认');
          entry.mastered = input.mastered; entry.version += 1;
          await saveLedger(ledger);
          return { mastered: entry.mastered };
        }
        const id = dayKey(family.id, today);
        const day = (await tx.get('days', id)) || { familyId: family.id, date: today, tasks: [] };
        let task = day.tasks.find((item) => item.childId === input.childId && learning.contentId(item) === input.contentId);
        if (!task) {
          const mode = entry ? (entry.completedDates.length ? 'review' : 'manual') : 'new';
          task = learning.taskFrom(action === 'assignContent' ? candidate : entry.item, input.childId, `r_${input.childId}_${input.contentId}`, mode);
          day.tasks.push(task);
          learning.recordTasks(ledger, day.tasks.filter((item) => item.childId === input.childId), today);
          await saveDay(id, day); await saveLedger(ledger);
        }
        return { task, date: today };
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
        const ledger = await readLedger(task.childId);
        learning.recordTasks(ledger, day.tasks.filter((item) => item.childId === task.childId), date);
        await saveLedger(ledger);
        await saveDay(id, day);
        await tx.put('receipts', receiptId, { familyId: family.id, fingerprint, task: clone(task), createdAt: timestamp });
        return { task: clone(task), duplicate: false };
      }
      throw new DomainError('INVALID', '未知操作');
    });
  }
  return { execute };
}
module.exports = { createService, DomainError, chinaDate, dayKey };
