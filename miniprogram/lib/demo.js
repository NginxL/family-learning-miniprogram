// Single-device demonstration. Uses the same learning rules as the deployed cloud function.
const { chinaDate } = require('./sync-engine');
const learning = require('./learning/learning');
function createDemo(wx) {
  const read = () => wx.getStorageSync('demo-backend-v1') || { family: null, days: {}, ledgers: {} };
  const write = (data) => wx.setStorageSync('demo-backend-v1', data);
  const id = () => `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const profile = (input, today) => {
    const age = input.age == null ? null : input.age;
    const schoolGrade = input.schoolGrade == null ? null : input.schoolGrade;
    if (age !== null && (!Number.isInteger(age) || age < 1 || age > 18)) throw new Error('年龄需为1–18岁，或留空');
    if (schoolGrade !== null && (!Number.isInteger(schoolGrade) || schoolGrade < 1 || schoolGrade > 9)) throw new Error('请选择在读年级，或留空');
    return { age, schoolGrade, ageRecordedOn: age === null ? null : today };
  };
  return async (action, input = {}) => {
    const state = read(); state.ledgers = state.ledgers || {};
    const today = chinaDate();
    const ledgerFor = (childId) => {
      if (!state.family.children.some((child) => child.id === childId)) throw new Error('孩子档案不存在');
      return state.ledgers[childId] || (state.ledgers[childId] = { records: {} });
    };
    if (action === 'bootstrap') return { userId: 'demo-parent', today, family: state.family };
    if (action === 'createFamily') {
      if (state.family) throw new Error('家庭已创建，请刷新');
      if (!input.name || !input.memberName || !input.childName) throw new Error('请填写家庭名称、你的称呼和孩子昵称');
      const childId = 'demo-child';
      state.family = { id: 'demo-family', name: input.name, ownerId: 'demo-parent', myRole: 'owner',
        members: [{ id: 'demo-parent', name: input.memberName, role: 'owner' }], children: [{ id: childId, name: input.childName, ...profile(input, today), version: 0 }],
        plans: [], autoPlans: { [childId]: learning.defaultRules() } };
      write(state); return { family: state.family };
    }
    if (['joinFamily', 'createInvite', 'removeMember', 'leaveFamily'].includes(action)) throw new Error('演示模式仅在本机运行；连接云开发后可邀请和同步');
    if (!state.family) throw new Error('请先创建演示家庭');
    // Index previous demo check-ins so an upgrade retains the family's old learning history.
    Object.values(state.days).forEach((day) => state.family.children.forEach((child) => {
      learning.recordTasks(ledgerFor(child.id), day.tasks.filter((task) => task.childId === child.id), day.date);
    }));
    if (action === 'getDay') {
      const date = input.date || today;
      const day = state.days[date] || { date, familyId: state.family.id, tasks: [] };
      if (date === today) {
        state.family.children.forEach((child) => ledgerFor(child.id));
        learning.generateDay(state.family, day, state.ledgers);
      }
      state.days[date] = day; write(state); return { day, today };
    }
    if (action === 'getHistory') {
      const result = learning.history(ledgerFor(input.childId), input); write(state); return result;
    }
    if (action === 'getProgress') return learning.progress(ledgerFor(input.childId));
    if (action === 'setTaskDone') {
      const task = state.days[input.date] && state.days[input.date].tasks.find((item) => item.id === input.taskId);
      if (!task) throw new Error('任务不存在');
      if (task.version !== input.baseVersion) { const error = new Error('任务已更新，请刷新'); error.code = 'CONFLICT'; throw error; }
      task.done = input.done; task.version += 1; task.updatedBy = 'demo-parent'; task.updatedAt = Date.now();
      learning.recordTasks(ledgerFor(task.childId), state.days[input.date].tasks.filter((item) => item.childId === task.childId), input.date);
      write(state); return { task };
    }
    if (action === 'setMastery' || action === 'reviewContent' || action === 'assignContent') {
      const ledger = ledgerFor(input.childId); const entry = ledger.records[input.contentId];
      const candidate = learning.catalogById.get(input.contentId);
      if (action === 'assignContent') { if (!candidate) throw new Error('知识库中没有这项内容'); }
      else if (!entry || !entry.completedDates.length) throw new Error('请先完成这项学习');
      if (action === 'setMastery') {
        if (entry.version !== input.baseVersion) { const error = new Error('学习记录已更新，请刷新'); error.code = 'CONFLICT'; throw error; }
        entry.mastered = input.mastered; entry.version += 1; write(state); return { mastered: entry.mastered };
      }
      const day = state.days[today] || { date: today, familyId: state.family.id, tasks: [] };
      let task = day.tasks.find((item) => item.childId === input.childId && learning.contentId(item) === input.contentId);
      if (!task) {
        task = learning.taskFrom(action === 'assignContent' ? candidate : entry.item, input.childId, `r_${input.childId}_${input.contentId}`, entry ? (entry.completedDates.length ? 'review' : 'manual') : 'new');
        day.tasks.push(task);
      }
      learning.recordTasks(ledger, day.tasks.filter((item) => item.childId === input.childId), today);
      state.days[today] = day; write(state); return { task, date: today };
    }
    if (action === 'addChild') {
      if (!input.name || state.family.children.length >= 5) throw new Error('请输入昵称，最多5个档案');
      state.family.children.push({ id: id(), name: input.name, ...profile(input, today), version: 0 });
    } else if (action === 'updateChild') {
      ledgerFor(input.childId);
      const child = state.family.children.find((item) => item.id === input.childId);
      if (input.baseVersion !== (child.version || 0)) { const error = new Error('档案已更新，请刷新'); error.code = 'CONFLICT'; throw error; }
      if (!input.name || !input.name.trim() || input.name.trim().length > 16) throw new Error('请填写16字以内的昵称');
      Object.assign(child, { name: input.name.trim(), ...profile(input, today), version: (child.version || 0) + 1 });
    } else if (action === 'addPlan') {
      ledgerFor(input.childId);
      const kind = input.kind || learning.kindOf(input);
      if (!input.title || !input.title.trim() || state.family.plans.length >= 100 || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 120) throw new Error('请填写名称和1–120分钟的时长；最多100项');
      if (!learning.kinds.some((item) => item.id === kind && item.subject === input.subject)) throw new Error('请选择学习类型');
      if (input.studyGrade != null && (!Number.isInteger(input.studyGrade) || input.studyGrade < 1 || input.studyGrade > 9)) throw new Error('内容年级无效');
      state.family.plans.push({ id: id(), childId: input.childId, kind, subject: input.subject, title: input.title.trim(), detail: input.detail || '',
        minutes: input.minutes, enabled: true, source: '家长自建', schedule: input.schedule || 'daily', date: today,
        ...(input.studyGrade ? { studyGrade: input.studyGrade } : {}) });
    } else if (action === 'saveAutoPlans') {
      ledgerFor(input.childId);
      if (!Array.isArray(input.rules) || input.rules.length !== learning.kinds.length || new Set(input.rules.map((rule) => rule.kind)).size !== learning.kinds.length
        || input.rules.some((rule) => !learning.kinds.some((kind) => kind.id === rule.kind && Number.isInteger(rule.quantity) && rule.quantity >= 0 && rule.quantity <= kind.max)
          || !['new', 'review'].includes(rule.mode) || !learning.scopeOptions(rule.kind).some((scope) => scope.id === (rule.scope || 'starter')))) throw new Error('每日数量或类型无效');
      state.family.autoPlans = state.family.autoPlans || {};
      state.family.autoPlans[input.childId] = input.rules;
    } else if (action === 'setPlanEnabled') {
      const plan = state.family.plans.find((item) => item.id === input.planId);
      if (!plan) throw new Error('计划不存在');
      plan.enabled = input.enabled;
    } else { throw new Error('不支持的演示操作'); }
    write(state); return { family: state.family };
  };
}
module.exports = { createDemo };
