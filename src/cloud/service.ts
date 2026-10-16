import crypto = require('node:crypto');
import { DomainError, requireValue, text, identifier, validDate, planningDate, hash, chinaDate } from './validation';
import { createHomeworkService, type MediaStore, homeworkKey } from './homework';
import * as learning from './learning/learning';
import { ageFromBirthDate, withCurrentAge } from './learning/child-profile';
import type { ApiAction, ApiData, ApiPayloads, ApiResults, FamilyService, ProfileInput } from '../shared/api';
import type { AutoRule, Day, Family, PersistedLedger, PublicFamily, SchoolGrade, Store, WeeklyTemplateSchedule } from '../shared/models';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isOneOf = <T>(value: unknown, allowed: readonly T[]): value is T => allowed.some((item) => item === value);
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const reply = <A extends ApiAction>(_action: A, data: ApiResults[A]): ApiResults[A] => data;
interface ServiceOptions {
  media?: MediaStore;
  store: Store; now?: () => number; randomId?: () => string; inviteCode?: () => string;
  defaultChild?: ProfileInput & { name: string };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const dayKey = (familyId: string, date: string) => hash(`${familyId}:${date}`);

function validatedRules(value: unknown): AutoRule[] {
  requireValue(Array.isArray(value) && value.length === learning.kinds.length, 'INVALID', '请提供完整的每日安排');
  const seen = new Set();
  return value.map((rule: unknown): AutoRule => {
    requireValue(isRecord(rule), 'INVALID', '每日安排无效');
    const kind = learning.kinds.find((item) => item.id === rule.kind);
    requireValue(kind && !seen.has(kind.id) && isOneOf(rule.mode, ['new', 'review'] as const)
      && isInteger(rule.quantity) && rule.quantity >= 0 && rule.quantity <= kind.max, 'INVALID', '每日数量或新学／复习类型无效');
    const scope = rule.scope || 'starter';
    requireValue(isOneOf(scope, learning.scopeOptions(kind.id).map((item) => item.id)), 'INVALID', '学习内容范围无效');
    seen.add(kind.id); return { kind: kind.id, mode: rule.mode, quantity: rule.quantity, scope };
  });
}

function childProfile(input: Record<string, unknown>, today: string) {
  const birthDate = input.birthDate == null || input.birthDate === '' ? null : input.birthDate;
  const age = birthDate === null ? (input.age == null ? null : input.age) : ageFromBirthDate(birthDate, today);
  const schoolGrade = input.schoolGrade === undefined || input.schoolGrade === null ? null : input.schoolGrade;
  requireValue(birthDate === null || age !== null, 'INVALID', '出生日期无效或尚未到达');
  requireValue(birthDate !== null || age === null || (isInteger(age) && age >= 1 && age <= 18), 'INVALID', '年龄需为1–18岁，或留空');
  requireValue(schoolGrade === null || (isInteger(schoolGrade) && schoolGrade >= 1 && schoolGrade <= 9), 'INVALID', '在读年级需为1–9，或留空');
  return { birthDate: birthDate as string | null, age: age as number | null, schoolGrade: schoolGrade as SchoolGrade | null, ageRecordedOn: age === null ? null : today };
}
function publicFamily(family: Family, uid: string, today: string): PublicFamily {
  const member = family.members.find((item) => item.id === uid)!;
  const childId = member.role === 'child' ? member.childId : undefined;
  requireValue(member.role !== 'child' || (childId && family.children.some((child) => child.id === childId)), 'FORBIDDEN', '孩子绑定状态无效，请联系家长');
  return {
    id: family.id, name: family.name, ownerId: family.ownerId,
    members: family.members.map(({ id, name, role, childId }) => ({ id, name, role, ...(childId ? { childId } : {}) })),
    children: family.children.filter((child) => !childId || child.id === childId).map((child) => withCurrentAge(child, today)), plans: clone(family.plans.filter((plan) => !childId || plan.childId === childId)), autoPlans: clone(childId ? { [childId]: family.autoPlans?.[childId] || [] } : family.autoPlans || {}),
    ...(family.templateSets ? { templateSets: clone(childId ? (family.templateSets[childId] ? { [childId]: family.templateSets[childId] } : {}) : family.templateSets) } : {}),
    myRole: member.role, ...(childId ? { myChildId: childId } : {}),
    canJoinFamily: family.autoCreated === true && family.ownerId === uid && family.members.length === 1
  };
}

function createService({ store, media, now = Date.now, randomId = () => crypto.randomBytes(16).toString('hex'),
  inviteCode = () => crypto.randomBytes(12).toString('hex').toUpperCase(),
  defaultChild = { name: '孩子', age: 6, schoolGrade: 1 } }: ServiceOptions): FamilyService {
  const homework = createHomeworkService(store, media);
  async function executeRaw(openid: unknown, action: unknown, rawInput: unknown = {}): Promise<ApiData> {
    requireValue(typeof openid === 'string' && openid.length > 0, 'UNAUTHENTICATED', '请通过微信小程序进入');
    requireValue(isRecord(rawInput), 'INVALID', '请求内容无效');
    const input = rawInput;
    const uid = hash(openid);
    const timestamp = now();
    const today = chinaDate(timestamp);
    const newId = randomId();
    if (homework.handles(action)) return homework.execute(uid, action, input, timestamp);
    const code = action === 'createInvite' ? inviteCode() : null;

    return store.run<ApiData>(async (tx) => {
      const profile = await tx.get('profiles', uid);
      const ownedFamilyId = `f_${uid.slice(0, 32)}`;
      const makeFamily = (values: Record<string, unknown>, autoCreated = false): Family => {
        const childId = `c_${newId}`;
        return {
          id: ownedFamilyId, name: text(values.name, '家庭名称', 24), ownerId: uid,
          members: [{ id: uid, name: text(values.memberName, '你的称呼', 16), role: 'owner' }],
          children: [{ id: childId, name: text(values.childName, '孩子昵称', 16), ...childProfile(values, today), version: 0 }],
          plans: [], autoPlans: { [childId]: learning.defaultRules() },
          createdAt: timestamp, activeInviteHash: null, autoCreated
        };
      };
      if (action === 'bootstrap') {
        let family = profile && profile.familyId ? await tx.get('families', profile.familyId) : null;
        const belongs = family && family.members.some((member) => member.id === uid);
        if (!belongs && input.ensureDefault === true) {
          family = await tx.get('families', ownedFamilyId);
          if (family) {
            requireValue(family.ownerId === uid && family.members.some((member) => member.id === uid), 'FORBIDDEN', '无法读取学习档案，请联系管理员');
          } else {
            family = makeFamily({ name: '我的家庭', memberName: '我', childName: defaultChild.name,
              birthDate: defaultChild.birthDate, age: defaultChild.age, schoolGrade: defaultChild.schoolGrade }, true);
            await tx.put('families', ownedFamilyId, family);
          }
          await tx.put('profiles', uid, { familyId: ownedFamilyId });
        } else if (!belongs) family = null;
        const child = family && family.children.length === 1 && family.children[0];
        // Populate a newly configured birthday only on an untouched, owned default.
        // Existing edits, invited families and explicitly cleared dates are preserved.
        if (family && family.autoCreated === true && family.ownerId === uid && child && !child.birthDate
          && (child.version || 0) === 0 && child.name === defaultChild.name && defaultChild.birthDate) {
          Object.assign(child, childProfile({ ...child, birthDate: defaultChild.birthDate }, today), { version: 1 });
          await tx.put('families', family.id, family);
        }
        return reply(action, { userId: uid, today, family: family ? publicFamily(family, uid, today) : null });
      }
      if (action === 'createFamily') {
        requireValue(!profile || !profile.familyId, 'ALREADY_JOINED', '你已加入一个家庭');
        const familyId = ownedFamilyId;
        // Deterministic ownership makes a retried creation safe, including after a lost response.
        const existing = await tx.get('families', familyId);
        requireValue(!existing, 'ALREADY_JOINED', '家庭已创建，请刷新');
        const family = makeFamily(input);
        await tx.put('families', familyId, family);
        await tx.put('profiles', uid, { familyId });
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'joinFamily') {
        if (profile && profile.familyId) {
          const current = await tx.get('families', profile.familyId);
          requireValue(current && current.autoCreated === true && current.ownerId === uid && current.members.length === 1
            && input.replaceDefaultFamilyId === current.id, 'ALREADY_JOINED', '你已加入一个家庭');
        }
        const enteredCode = text(input.code, '邀请码', 32).replace(/\s/g, '').toUpperCase();
        requireValue(/^[A-F0-9]{24}$/.test(enteredCode), 'INVALID_INVITE', '邀请码无效');
        const inviteHash = hash(enteredCode);
        const invite = await tx.get('invites', inviteHash);
        requireValue(invite && !invite.usedAt && invite.expiresAt > timestamp, 'INVALID_INVITE', '邀请码无效、已使用或已过期');
        const family = await tx.get('families', invite.familyId);
        requireValue(family && family.activeInviteHash === inviteHash, 'INVALID_INVITE', '邀请码已失效');
        requireValue(!profile || profile.familyId !== family.id, 'ALREADY_JOINED', '你已在这个家庭中');
        requireValue(family.members.length < 10, 'LIMIT', '一个家庭最多10位成员');
        const inviteRole = invite.role || 'guardian';
        if (inviteRole === 'child') requireValue(invite.guardianConsentAt && family.children.some((child) => child.id === invite.childId), 'INVALID_INVITE', '孩子绑定码已失效');
        family.members.push({ id: uid, name: text(input.memberName, '你的称呼', 16), role: inviteRole,
          ...(inviteRole === 'child' ? { childId: invite.childId } : {}) });
        family.activeInviteHash = null;
        await tx.put('families', family.id, family);
        await tx.put('profiles', uid, { familyId: family.id });
        await tx.put('invites', inviteHash, { ...invite, usedAt: timestamp });
        return reply(action, { family: publicFamily(family, uid, today) });
      }

      requireValue(profile && profile.familyId && profile.familyId === input.familyId, 'FORBIDDEN', '当前账号没有这个家庭的访问权限');
      const family = await tx.get('families', profile.familyId);
      requireValue(family && family.members.some((member) => member.id === uid), 'FORBIDDEN', '你已不在这个家庭中');
      const member = family.members.find((item) => item.id === uid)!;
      const isChild = member.role === 'child';
      requireValue(!isChild || ['getDay', 'getHistory', 'getProgress'].includes(String(action)), 'PARENT_REQUIRED', '此操作需要家长确认，孩子只能提交作业');
      const owner = () => requireValue(family.ownerId === uid, 'FORBIDDEN', '只有家庭创建者可以操作');
      function childExists(childId: unknown): asserts childId is string {
        requireValue(typeof childId === 'string' && family!.children.some((child) => child.id === childId), 'INVALID', '孩子档案不存在');
        requireValue(!isChild || member.childId === childId, 'FORBIDDEN', '只能查看自己绑定的学习档案');
      }
      const ledgerKey = (childId: string) => hash(`${family.id}:${childId}`);
      const readLedger = async (childId: string): Promise<PersistedLedger> => (await tx.get('learning', ledgerKey(childId))) || { familyId: family.id, childId, records: {} };
      const saveLedger = async (ledger: PersistedLedger) => {
        // Leave headroom below the CloudBase document limit; fail atomically instead of dropping history.
        requireValue(Buffer.byteLength(JSON.stringify(ledger), 'utf8') < 700 * 1024, 'LIMIT', '学习档案容量已满，请联系管理员扩容后重试');
        await tx.put('learning', ledgerKey(ledger.childId), ledger);
      };
      const saveDay = async (id: string, day: Day) => {
        requireValue(Buffer.byteLength(JSON.stringify(day), 'utf8') < 700 * 1024, 'LIMIT', '当天任务较多，请减少安排后重试');
        await tx.put('days', id, day);
      };

      const freezeCurrentDay = async (childId: string) => {
        const id = dayKey(family.id, today); const day = await tx.get('days', id);
        if (!day) return;
        const before = JSON.stringify(day);
        learning.freezeTemplateDay(family, day, childId);
        if (before !== JSON.stringify(day)) await saveDay(id, day);
      };

      if (action === 'createInvite') {
        owner();
        const role = input.role === undefined ? 'guardian' : input.role;
        requireValue(role === 'guardian' || role === 'child', 'INVALID', '请选择家长或孩子身份');
        if (role === 'child') { childExists(input.childId); requireValue(input.guardianConsent === true, 'INVALID', '请由监护人确认孩子提交录音和照片的用途'); }
        const inviteHash = hash(code!);
        const expiresAt = timestamp + 24 * 3600000;
        family.activeInviteHash = inviteHash;
        await tx.put('invites', inviteHash, { familyId: family.id, expiresAt, usedAt: null,
          ...(role === 'child' ? { role, childId: input.childId as string, guardianConsentAt: timestamp } : {}) });
        await tx.put('families', family.id, family);
        return reply(action, { code: code!, expiresAt });
      }
      if (action === 'removeMember' || action === 'leaveFamily') {
        const memberId = action === 'leaveFamily' ? uid : identifier(input.memberId);
        if (action === 'removeMember') owner();
        requireValue(memberId !== family.ownerId, 'INVALID', '创建者需要保留在家庭中');
        family.members = family.members.filter((member) => member.id !== memberId);
        const removedProfile = await tx.get('profiles', memberId);
        if (removedProfile && removedProfile.familyId === family.id) await tx.put('profiles', memberId, { familyId: null });
        await tx.put('families', family.id, family);
        return reply(action, { removed: true });
      }
      if (action === 'addChild') {
        owner();
        requireValue(family.children.length < 5, 'LIMIT', '一个家庭最多5个孩子档案');
        family.children.push({ id: `c_${newId}`, name: text(input.name, '孩子昵称', 16), ...childProfile(input, today), version: 0 });
        await tx.put('families', family.id, family);
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'updateChild') {
        owner(); childExists(input.childId);
        const child = family.children.find((item) => item.id === input.childId)!;
        requireValue(isInteger(input.baseVersion) && input.baseVersion === (child.version || 0), 'CONFLICT', '档案已更新，请刷新后再修改');
        Object.assign(child, { name: text(input.name, '孩子昵称', 16),
          ...childProfile({ ...input, birthDate: input.birthDate === undefined ? child.birthDate : input.birthDate }, today), version: (child.version || 0) + 1 });
        await tx.put('families', family.id, family);
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'addPlan') {
        childExists(input.childId);
        requireValue(family.plans.length < 100, 'LIMIT', '最多保存100项学习计划');
        requireValue(isOneOf(input.subject, ['poetry', 'english', 'reading', 'math', 'other'] as const), 'INVALID', '请选择学习科目');
        const kind = input.kind || learning.kindOf(input);
        requireValue(isOneOf(kind, learning.kinds.map((item) => item.id)) && learning.kinds.some((item) => item.id === kind && item.subject === input.subject), 'INVALID', '学习类型与科目不匹配');
        const schedule = input.schedule || 'daily';
        requireValue(isOneOf(schedule, ['once', 'daily', 'library'] as const), 'INVALID', '请选择安排方式');
        requireValue(isInteger(input.minutes) && input.minutes >= 1 && input.minutes <= 120, 'INVALID', '时长需为1–120分钟');
        requireValue(input.studyGrade === undefined || input.studyGrade === null || (isInteger(input.studyGrade) && input.studyGrade >= 1 && input.studyGrade <= 9), 'INVALID', '学习年级无效');
        const date = planningDate(input.date === undefined ? today : input.date, timestamp);
        family.plans.push({ id: `p_${newId}`, childId: input.childId, title: text(input.title, '任务名称', 60),
          detail: typeof input.detail === 'string' ? input.detail.trim().slice(0, 2000) : '',
          subject: input.subject, kind, schedule, date, minutes: input.minutes, enabled: true, source: '家长自建',
          ...(schedule === 'daily' && input.date !== undefined ? { startDate: date } : {}),
          ...(input.studyGrade ? { studyGrade: input.studyGrade as SchoolGrade } : {}) });
        if (schedule === 'once') requireValue(!learning.wasLearned(await readLedger(input.childId), family.plans[family.plans.length - 1]),
          'ALREADY_LEARNED', '已学过这项内容，请从回顾中安排复习');
        await tx.put('families', family.id, family);
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'setPlanEnabled') {
        const plan = family.plans.find((item) => item.id === input.planId);
        requireValue(plan && typeof input.enabled === 'boolean', 'INVALID', '学习计划不存在或状态无效');
        plan.enabled = input.enabled;
        await tx.put('families', family.id, family);
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'saveAutoPlans') {
        childExists(input.childId);
        const rules = validatedRules(input.rules);
        if (family.templateSets?.[input.childId]) {
          const set = learning.templateSet(family, input.childId);
          await freezeCurrentDay(input.childId);
          set.templates.find((item) => item.id === set.activeId)!.rules = rules;
          set.revision += 1; family.templateSets[input.childId] = set;
        }
        family.autoPlans = family.autoPlans || {};
        family.autoPlans[input.childId] = rules;
        await tx.put('families', family.id, family);
        return reply(action, { family: publicFamily(family, uid, today) });
      }
      if (action === 'saveDailyTemplate' || action === 'activateDailyTemplate' || action === 'deleteDailyTemplate' || action === 'saveTemplateSchedule') {
        childExists(input.childId);
        const templateId = identifier(action === 'saveTemplateSchedule' ? input.activeId : input.templateId); identifier(input.mutationId);
        requireValue(isInteger(input.baseRevision) && input.baseRevision >= 0, 'INVALID', '模板版本无效');
        const name = action === 'saveDailyTemplate' ? text(input.name, '模板名称', 24) : undefined;
        const rules = action === 'saveDailyTemplate' ? validatedRules(input.rules) : undefined;
        if (action === 'saveDailyTemplate') requireValue(typeof input.activate === 'boolean', 'INVALID', '请选择是否启用模板');
        let weeklySchedule: WeeklyTemplateSchedule | null = null;
        if (action === 'saveTemplateSchedule') {
          requireValue(input.weeklySchedule === null || isRecord(input.weeklySchedule), 'INVALID', '星期安排无效');
          if (input.weeklySchedule) weeklySchedule = {
            weekdaysTemplateId: identifier(input.weeklySchedule.weekdaysTemplateId), weekendTemplateId: identifier(input.weeklySchedule.weekendTemplateId)
          };
        }
        // Keep the existing fingerprint shape so pre-upgrade template retries remain valid.
        const fingerprint = hash(JSON.stringify(action === 'saveTemplateSchedule'
          ? [action, family.id, input.childId, templateId, input.baseRevision, weeklySchedule]
          : [action, family.id, input.childId, templateId, input.baseRevision, name, rules, input.activate]));
        const receiptId = hash(`${uid}:${input.mutationId}`);
        const receipt = await tx.get('receipts', receiptId);
        if (receipt) {
          requireValue(receipt.fingerprint === fingerprint && 'template' in receipt, 'INVALID', '操作编号已用于其他请求');
          return reply(action, { family: publicFamily(family, uid, today), duplicate: true });
        }
        const set = learning.templateSet(family, input.childId);
        requireValue(set.revision === input.baseRevision, 'CONFLICT', '家人已更新任务模板，请重新载入后再修改');
        const index = set.templates.findIndex((item) => item.id === templateId);
        if (action === 'saveTemplateSchedule') {
          requireValue(index >= 0 && (!weeklySchedule || [weeklySchedule.weekdaysTemplateId, weeklySchedule.weekendTemplateId]
            .every((id) => set.templates.some((item) => item.id === id))), 'INVALID', '请选择当前孩子已有的模板');
          await freezeCurrentDay(input.childId);
          set.activeId = templateId;
          if (weeklySchedule) set.weeklySchedule = weeklySchedule; else delete set.weeklySchedule;
        } else if (action === 'saveDailyTemplate') {
          requireValue(!set.templates.some((item) => item.id !== templateId && item.name === name), 'INVALID', '已有同名模板，请换一个名称');
          requireValue(index >= 0 || set.templates.length < 10, 'LIMIT', '每个孩子最多保存10个模板');
          if (set.activeId === templateId || learning.templateForDate(family, input.childId, today).id === templateId || input.activate) await freezeCurrentDay(input.childId);
          const template = { id: templateId, name: name!, rules: rules! };
          if (index >= 0) set.templates[index] = template; else set.templates.push(template);
          if (input.activate) set.activeId = templateId;
        } else {
          requireValue(index >= 0, 'NOT_FOUND', '模板不存在，请刷新');
          if (action === 'deleteDailyTemplate') {
            requireValue(set.activeId !== templateId, 'INVALID', '请先启用其他模板，再删除当前模板');
            requireValue(!set.weeklySchedule || ![set.weeklySchedule.weekdaysTemplateId, set.weeklySchedule.weekendTemplateId].includes(templateId), 'INVALID', '请先调整星期安排，再删除这个模板');
            set.templates.splice(index, 1);
          } else {
            await freezeCurrentDay(input.childId); set.activeId = templateId;
          }
        }
        set.revision += 1;
        family.templateSets = { ...family.templateSets, [input.childId]: set };
        family.autoPlans = { ...family.autoPlans, [input.childId]: clone(set.templates.find((item) => item.id === set.activeId)!.rules) };
        await tx.put('families', family.id, family);
        await tx.put('receipts', receiptId, { familyId: family.id, fingerprint, template: { childId: input.childId }, createdAt: timestamp });
        return reply(action, { family: publicFamily(family, uid, today), duplicate: false });
      }
      if (action === 'getDay') {
        const requested = input.date === undefined ? today : input.date;
        const date = typeof requested === 'string' && requested > today ? planningDate(requested, timestamp) : validDate(requested, timestamp);
        const id = dayKey(family.id, date);
        let day = await tx.get('days', id);
        const beforeDay = JSON.stringify(day);
        const ledgers: Record<string, PersistedLedger> = {};
        const originals: Record<string, string> = {};
        for (const child of family.children) {
          ledgers[child.id] = await readLedger(child.id);
          originals[child.id] = JSON.stringify(ledgers[child.id]);
        }
        // Old assignments are indexed when viewed, but no past tasks are invented.
        if (date >= today) {
          // Reserve today's real tasks first, even when the app opens on Tomorrow.
          // Only the current day and its ledgers are persisted; future automatic tasks are a projection.
          if (date > today) {
            const currentId = dayKey(family.id, today);
            const stored = await tx.get('days', currentId);
            const current = stored || { familyId: family.id, date: today, tasks: [] };
            const before = JSON.stringify(stored);
            learning.generateDay(family, current, ledgers);
            if (JSON.stringify(current) !== before) await saveDay(currentId, current);
            for (const child of family.children) {
              if (originals[child.id] !== JSON.stringify(ledgers[child.id])) await saveLedger(ledgers[child.id]);
              originals[child.id] = JSON.stringify(ledgers[child.id]);
            }
          }
          day = day || { familyId: family.id, date, tasks: [] };
          learning.generateDay(family, day, date > today ? clone(ledgers) : ledgers, date > today);
          if (date === today && JSON.stringify(day) !== beforeDay) await saveDay(id, day);
        } else if (day) {
          for (const child of family.children) learning.recordTasks(ledgers[child.id], day.tasks.filter((task) => task.childId === child.id), date);
        }
        for (const child of family.children) if (originals[child.id] !== JSON.stringify(ledgers[child.id])) await saveLedger(ledgers[child.id]);
        const visible = day || { familyId: family.id, date, tasks: [] };
        return reply(action, { day: isChild ? { ...visible, tasks: visible.tasks.filter((task) => task.childId === member.childId),
          omitted: (visible.omitted || []).filter((item) => item.childId === member.childId),
          generated: { [member.childId!]: visible.generated?.[member.childId!] || {} },
          warnings: (visible.warnings || []).filter((warning) => warning.childId === member.childId) } : visible, today });
      }
      if (action === 'getHistory') {
        childExists(input.childId);
        requireValue(input.subject === undefined || isOneOf(input.subject, learning.subjects.map((item) => item.id)), 'INVALID', '科目无效');
        requireValue(input.filter === undefined || isOneOf(input.filter, ['all', 'learned', 'mastered'] as const), 'INVALID', '回顾范围无效');
        requireValue(input.query === undefined || (typeof input.query === 'string' && input.query.length <= 80), 'INVALID', '搜索内容过长');
        requireValue(input.offset === undefined || (isInteger(input.offset) && input.offset >= 0 && input.offset <= 100000), 'INVALID', '分页无效');
        return reply(action, learning.history(await readLedger(input.childId), { subject: input.subject, filter: input.filter, query: input.query, offset: input.offset }));
      }
      if (action === 'getProgress') {
        childExists(input.childId);
        return reply(action, learning.progress(await readLedger(input.childId)));
      }
      if (action === 'editPlannedTask') {
        const date = planningDate(input.date, timestamp);
        requireValue(date > today, 'INVALID', '只能调整未来的未完成安排，今日及历史记录保留');
        const targetDate = input.targetDate === undefined ? undefined : planningDate(input.targetDate, timestamp);
        requireValue(targetDate !== date, 'INVALID', '请选择不同的学习日期');
        identifier(input.taskId); identifier(input.contentId); identifier(input.mutationId);
        requireValue(isInteger(input.baseVersion) && input.baseVersion >= 0 && isInteger(input.planRevision) && input.planRevision >= 0, 'INVALID', '计划版本无效');
        const receiptId = hash(`${uid}:${input.mutationId}`);
        const fingerprint = hash(JSON.stringify([action, family.id, date, input.taskId, input.contentId, input.baseVersion, input.planRevision, targetDate]));
        const receipt = await tx.get('receipts', receiptId);
        if (receipt) {
          requireValue(receipt.fingerprint === fingerprint && 'planning' in receipt, 'INVALID', '操作编号已用于其他请求');
          return reply(action, { ...receipt.planning, duplicate: true });
        }
        const id = dayKey(family.id, date);
        const source: Day = (await tx.get('days', id)) || { familyId: family.id, date, tasks: [] };
        requireValue((source.planRevision || 0) === input.planRevision, 'CONFLICT', '家人已调整这天的计划，请刷新后再操作');
        // Reconstruct the same preview without creating or changing any learning records.
        const ledgers: Record<string, PersistedLedger> = {};
        for (const child of family.children) ledgers[child.id] = await readLedger(child.id);
        const current = (await tx.get('days', dayKey(family.id, today))) || { familyId: family.id, date: today, tasks: [] };
        learning.generateDay(family, current, ledgers);
        const preview = learning.generateDay(family, clone(source), clone(ledgers), true);
        const task = preview.tasks.find((item) => item.id === input.taskId && item.contentId === input.contentId);
        requireValue(task && task.version === input.baseVersion, 'CONFLICT', '任务已变化，请刷新明日计划后再操作');
        requireValue(!task.done, 'COMPLETED', '已完成的学习记录不能删除或改期');
        let merged = false;
        if (targetDate) {
          const repeatAllowed = learning.allowsRepeat(family, task);
          requireValue(repeatAllowed || !learning.wasLearned(ledgers[task.childId], task), 'ALREADY_LEARNED', '已学过这项内容，请从回顾中安排复习');
          const targetId = dayKey(family.id, targetDate);
          const target: Day = (await tx.get('days', targetId)) || { familyId: family.id, date: targetDate, tasks: [] };
          const matches = (item: typeof task) => item.childId === task.childId && learning.planningKey(item) === learning.planningKey(task);
          const existing = target.tasks.find(matches);
          const projected = learning.generateDay(family, clone(target), clone(ledgers), targetDate > today).tasks.find(matches);
          merged = Boolean(existing || projected);
          if (!existing) {
            if (projected?.id.startsWith('a_')) learning.omitTask(target, projected);
            target.tasks.push({ ...clone(task), id: `r_${task.childId}_${task.contentId}`, mode: task.mode === 'review' ? 'review' : 'manual',
              ...(repeatAllowed ? { repeatAllowed: true as const } : {}),
              version: task.version + 1, updatedBy: uid, updatedAt: timestamp });
            target.planRevision = (target.planRevision || 0) + 1;
            await saveDay(targetId, target);
          }
          // Moving into today creates an uncompleted task only. No ledger is rewritten by this operation.
        }
        learning.omitTask(source, task);
        await saveDay(id, source);
        family.scheduledContents = (family.scheduledContents || []).filter((item) => item.date > today
          && !(item.childId === task.childId && item.date === date && (item.contentId === task.contentId
            || (learning.catalogById.has(item.contentId) && learning.planningKey({ id: item.contentId }) === learning.planningKey(task)))));
        if (targetDate && targetDate > today && !family.scheduledContents.some((item) => item.childId === task.childId && item.contentId === task.contentId && item.date === targetDate)) {
          requireValue(family.scheduledContents.length < 1000, 'LIMIT', '未来安排已达1000项，请在部分完成后再添加');
          family.scheduledContents.push({ childId: task.childId, contentId: task.contentId, date: targetDate });
        }
        await tx.put('families', family.id, family);
        const result = { date, ...(targetDate ? { targetDate } : {}), merged };
        await tx.put('receipts', receiptId, { familyId: family.id, fingerprint, planning: result, createdAt: timestamp });
        return reply(action, { ...result, duplicate: false });
      }
      if (action === 'setMastery' || action === 'reviewContent' || action === 'assignContent') {
        childExists(input.childId); const contentId = identifier(input.contentId);
        const ledger = await readLedger(input.childId);
        const entry = Object.hasOwn(ledger.records, contentId) ? ledger.records[contentId] : null;
        const candidate = learning.catalogById.get(contentId);
        if (action === 'assignContent') requireValue(candidate, 'INVALID', '知识库中没有这项内容，请更新小程序后重试');
        else requireValue(entry && entry.completedDates.length, 'INVALID', '请先完成这项内容的学习');
        if (action === 'setMastery') {
          requireValue(typeof input.mastered === 'boolean' && isInteger(input.baseVersion), 'INVALID', '掌握状态无效');
          requireValue(entry!.version === input.baseVersion, 'CONFLICT', '家人已更新学习记录，请刷新后再确认');
          entry!.mastered = input.mastered; entry!.version += 1;
          await saveLedger(ledger);
          return reply(action, { mastered: entry!.mastered });
        }
        const date = action === 'assignContent' ? planningDate(input.date === undefined ? today : input.date, timestamp) : today;
        const material = action === 'assignContent' ? candidate! : entry!.item;
        requireValue(action === 'reviewContent' || !learning.wasLearned(ledger, material), 'ALREADY_LEARNED', '已学过这项内容，请从回顾中安排复习');
        if (date > today) {
          const scheduled = (family.scheduledContents || []).filter((item) => item.date > today);
          if (!scheduled.some((item) => item.childId === input.childId && item.contentId === contentId && item.date === date)) {
            requireValue(scheduled.length < 1000, 'LIMIT', '未来安排已达1000项，请在部分完成后再添加');
            scheduled.push({ childId: input.childId, contentId, date });
            family.scheduledContents = scheduled; await tx.put('families', family.id, family);
          }
        }
        const id = dayKey(family.id, date);
        const day = (await tx.get('days', id)) || { familyId: family.id, date, tasks: [] };
        let task = day.tasks.find((item) => item.childId === input.childId && learning.planningKey(item) === learning.planningKey(material));
        if (!task) {
          const mode = date > today ? 'manual' : entry ? (entry.completedDates.length ? 'review' : 'manual') : 'new';
          task = learning.taskFrom(action === 'assignContent' ? candidate! : entry!.item, input.childId, `r_${input.childId}_${contentId}`, mode);
          day.tasks.push(task);
          day.planRevision = (day.planRevision || 0) + 1;
          await saveDay(id, day);
          if (date === today) {
            learning.recordTasks(ledger, day.tasks.filter((item) => item.childId === input.childId), date);
            await saveLedger(ledger);
          }
        }
        return reply(action, { task, date });
      }
      if (action === 'setTaskDone') {
        const date = validDate(input.date, timestamp);
        identifier(input.taskId); identifier(input.mutationId);
        requireValue(typeof input.done === 'boolean' && isInteger(input.baseVersion) && input.baseVersion >= 0, 'INVALID', '任务状态无效');
        const receiptId = hash(`${uid}:${input.mutationId}`);
        const fingerprint = hash(JSON.stringify([family.id, date, input.taskId, input.done, input.baseVersion]));
        const receipt = await tx.get('receipts', receiptId);
        if (receipt) {
          requireValue(receipt.fingerprint === fingerprint && 'task' in receipt, 'INVALID', '操作编号已用于其他请求');
          return reply(action, { task: receipt.task, duplicate: true });
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
        const group = day.tasks.filter((item) => item.childId === task.childId && learning.kindOf(item) === learning.kindOf(task));
        const hwId = homeworkKey({ familyId: family.id, childId: task.childId, date, kind: learning.kindOf(task) });
        const submitted = await tx.get('homeworks', hwId);
        if (submitted && ((group.every((item) => item.done) && submitted.status !== 'approved') || (!task.done && submitted.status === 'approved'))) {
          Object.assign(submitted, { status: task.done ? 'approved' : 'returned', reviewedBy: uid, reviewedAt: timestamp, version: submitted.version + 1,
            feedback: task.done ? '' : '家长撤销了完成，请重新提交作业。' });
          await tx.put('homeworks', hwId, submitted);
        }
        await tx.put('receipts', receiptId, { familyId: family.id, fingerprint, task: clone(task), createdAt: timestamp });
        return reply(action, { task: clone(task), duplicate: false });
      }
      throw new DomainError('INVALID', '未知操作');
    });
  }
  function execute<A extends ApiAction>(openid: string, action: A, payload: ApiPayloads[A]): Promise<ApiResults[A]>;
  function execute(openid: unknown, action: unknown, payload?: unknown): Promise<ApiData> {
    return executeRaw(openid, action, payload);
  }
  return { execute, executeRaw };
}
export { createService, DomainError, chinaDate, dayKey };
