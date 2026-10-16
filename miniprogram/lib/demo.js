// Single-device demonstration. Uses the same learning rules as the deployed cloud function.
const { chinaDate } = require('./sync-engine');
const learning = require('./learning/learning');
const { ageFromBirthDate, withCurrentAge } = require('./learning/child-profile');
function createDemo(wx) {
  const read = () => JSON.parse(JSON.stringify(wx.getStorageSync('demo-backend-v1') || { family: null, days: {}, ledgers: {} }));
  const write = (data) => wx.setStorageSync('demo-backend-v1', data);
  const id = () => `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const planDate = (value, today) => {
    const time = Date.parse(`${value}T00:00:00Z`);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time)
      || new Date(time).toISOString().slice(0, 10) !== value || value < today || time - Date.parse(`${today}T00:00:00Z`) > 365 * 86400000) throw new Error('请选择今日起一年内的日期');
    return value;
  };
  const validateRules = rules => {
      if (!Array.isArray(rules) || rules.length !== learning.kinds.length || new Set(rules.map((rule) => rule.kind)).size !== learning.kinds.length
        || rules.some((rule) => !learning.kinds.some((kind) => kind.id === rule.kind && Number.isInteger(rule.quantity) && rule.quantity >= 0 && rule.quantity <= kind.max)
          || !['new', 'review'].includes(rule.mode) || !learning.scopeOptions(rule.kind).some((scope) => scope.id === (rule.scope || 'starter')))) throw new Error('每日数量或类型无效');
  };
  const profile = (input, today) => {
    const birthDate = input.birthDate == null || input.birthDate === '' ? null : input.birthDate;
    const age = birthDate === null ? (input.age == null ? null : input.age) : ageFromBirthDate(birthDate, today);
    const schoolGrade = input.schoolGrade == null ? null : input.schoolGrade;
    if (birthDate !== null && age === null) throw new Error('出生日期无效或尚未到达');
    if (birthDate === null && age !== null && (!Number.isInteger(age) || age < 1 || age > 18)) throw new Error('年龄需为1–18岁，或留空');
    if (schoolGrade !== null && (!Number.isInteger(schoolGrade) || schoolGrade < 1 || schoolGrade > 9)) throw new Error('请选择在读年级，或留空');
    return { birthDate, age, schoolGrade, ageRecordedOn: age === null ? null : today };
  };
  return async (action, input = {}) => {
    const state = read(); state.ledgers = state.ledgers || {};
    const today = chinaDate();
    if (state.family) state.family.children = state.family.children.map((child) => withCurrentAge(child, today));
    const ledgerFor = (childId) => {
      if (!state.family.children.some((child) => child.id === childId)) throw new Error('孩子档案不存在');
      return state.ledgers[childId] || (state.ledgers[childId] = { records: {} });
    };
    if (action === 'bootstrap') {
      if (!state.family && input.ensureDefault === true) {
        state.family = { id: 'demo-family', name: '我的家庭', ownerId: 'demo-parent', myRole: 'owner', canJoinFamily: false,
          members: [{ id: 'demo-parent', name: '我', role: 'owner' }],
          children: [{ id: 'demo-child', name: '孩子', age: 6, schoolGrade: 1, ageRecordedOn: today, version: 0 }],
          plans: [], autoPlans: { 'demo-child': learning.defaultRules() } };
        write(state);
      }
      return { userId: 'demo-parent', today, family: state.family };
    }
    if (action === 'createFamily') {
      if (state.family) throw new Error('家庭已创建，请刷新');
      if (!input.name || !input.memberName || !input.childName) throw new Error('请填写家庭名称、你的称呼和孩子昵称');
      const childId = 'demo-child';
      state.family = { id: 'demo-family', name: input.name, ownerId: 'demo-parent', myRole: 'owner',
        members: [{ id: 'demo-parent', name: input.memberName, role: 'owner' }], children: [{ id: childId, name: input.childName, ...profile(input, today), version: 0 }],
        plans: [], autoPlans: { [childId]: learning.defaultRules() } };
      write(state); return { family: state.family };
    }
    if (action === 'getHomework') return { homework: null };
    if (['joinFamily', 'createInvite', 'removeMember', 'leaveFamily', 'uploadHomeworkAttachment', 'submitHomework', 'getHomeworkAttachment', 'reviewHomework'].includes(action)) throw new Error('演示模式仅在本机运行；连接云开发后可邀请、提交作业和同步');
    if (!state.family) throw new Error('请先加载学习档案');
    // Index previous demo check-ins so an upgrade retains the family's old learning history.
    Object.values(state.days).filter((day) => day.date <= today).forEach((day) => state.family.children.forEach((child) => {
      learning.recordTasks(ledgerFor(child.id), day.tasks.filter((task) => task.childId === child.id), day.date);
    }));
    if (['saveDailyTemplate', 'activateDailyTemplate', 'deleteDailyTemplate', 'saveTemplateSchedule'].includes(action)) {
      ledgerFor(input.childId);
      const invalid = message => Object.assign(new Error(message), { code: 'INVALID' });
      const templateId = action === 'saveTemplateSchedule' ? input.activeId : input.templateId;
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(templateId || '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.mutationId || '')
        || !Number.isInteger(input.baseRevision) || input.baseRevision < 0) throw invalid('模板编号或版本无效');
      const name = action === 'saveDailyTemplate' ? String(input.name || '').trim() : undefined;
      if (action === 'saveDailyTemplate') {
        if (!name || name.length > 24 || typeof input.activate !== 'boolean') throw invalid('请填写24字以内的模板名称');
        validateRules(input.rules);
      }
      let weeklySchedule = null;
      if (action === 'saveTemplateSchedule') {
        if (input.weeklySchedule !== null) {
          if (!input.weeklySchedule || Array.isArray(input.weeklySchedule)
            || !['weekdaysTemplateId', 'weekendTemplateId'].every(key => typeof input.weeklySchedule[key] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.weeklySchedule[key]))) throw invalid('星期安排无效');
          weeklySchedule = { weekdaysTemplateId: input.weeklySchedule.weekdaysTemplateId, weekendTemplateId: input.weeklySchedule.weekendTemplateId };
        }
      }
      const fingerprint = JSON.stringify(action === 'saveTemplateSchedule'
        ? [action, input.childId, templateId, input.baseRevision, weeklySchedule]
        : [action, input.childId, input.templateId, input.baseRevision, name, input.rules, input.activate]);
      state.templateReceipts = state.templateReceipts || {};
      if (state.templateReceipts[input.mutationId]) {
        if (state.templateReceipts[input.mutationId] !== fingerprint) throw invalid('操作编号已用于其他请求');
        return { family: state.family, duplicate: true };
      }
      const set = learning.templateSet(state.family, input.childId);
      if (set.revision !== input.baseRevision) throw Object.assign(new Error('家人已更新任务模板，请重新载入后再修改'), { code: 'CONFLICT' });
      const index = set.templates.findIndex(item => item.id === templateId);
      const freeze = () => { if (state.days[today]) learning.freezeTemplateDay(state.family, state.days[today], input.childId); };
      if (action === 'saveTemplateSchedule') {
        if (index < 0 || (weeklySchedule && ![weeklySchedule.weekdaysTemplateId, weeklySchedule.weekendTemplateId].every(id => set.templates.some(item => item.id === id)))) throw invalid('请选择当前孩子已有的模板');
        freeze(); set.activeId = templateId;
        if (weeklySchedule) set.weeklySchedule = weeklySchedule; else delete set.weeklySchedule;
      } else if (action === 'saveDailyTemplate') {
        if (set.templates.some(item => item.id !== input.templateId && item.name === name)) throw invalid('已有同名模板，请换一个名称');
        if (index < 0 && set.templates.length >= 10) throw invalid('每个孩子最多保存10个模板');
        if (set.activeId === input.templateId || learning.templateForDate(state.family, input.childId, today).id === input.templateId || input.activate) freeze();
        const template = { id: input.templateId, name, rules: input.rules };
        if (index >= 0) set.templates[index] = template; else set.templates.push(template);
        if (input.activate) set.activeId = input.templateId;
      } else {
        if (index < 0) throw invalid('模板不存在，请刷新');
        if (action === 'deleteDailyTemplate') {
          if (set.activeId === input.templateId) throw invalid('请先启用其他模板，再删除当前模板');
          if (set.weeklySchedule && [set.weeklySchedule.weekdaysTemplateId, set.weeklySchedule.weekendTemplateId].includes(input.templateId)) throw invalid('请先调整星期安排，再删除这个模板');
          set.templates.splice(index, 1);
        } else { freeze(); set.activeId = input.templateId; }
      }
      set.revision += 1;
      state.family.templateSets = { ...state.family.templateSets, [input.childId]: set };
      state.family.autoPlans = { ...state.family.autoPlans, [input.childId]: set.templates.find(item => item.id === set.activeId).rules };
      state.templateReceipts[input.mutationId] = fingerprint;
      write(state); return { family: state.family, duplicate: false };
    }
    if (action === 'getDay') {
      const date = input.date || today;
      if (date > today) {
        planDate(date, today);
        const current = state.days[today] || { date: today, familyId: state.family.id, tasks: [] };
        state.family.children.forEach((child) => ledgerFor(child.id));
        learning.generateDay(state.family, current, state.ledgers); state.days[today] = current;
        const preview = JSON.parse(JSON.stringify(state.days[date] || { date, familyId: state.family.id, tasks: [] }));
        learning.generateDay(state.family, preview, JSON.parse(JSON.stringify(state.ledgers)), true);
        write(state); return { day: preview, today };
      }
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
    if (action === 'editPlannedTask') {
      const date = planDate(input.date, today);
      if (date <= today) throw new Error('只能调整未来的未完成安排，今日及历史记录保留');
      const targetDate = input.targetDate === undefined ? undefined : planDate(input.targetDate, today);
      if (targetDate === date) throw new Error('请选择不同的学习日期');
      const fingerprint = JSON.stringify([date, input.taskId, input.contentId, input.baseVersion, input.planRevision, targetDate]);
      state.planReceipts = state.planReceipts || {};
      const receipt = state.planReceipts[input.mutationId];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('操作编号已用于其他请求');
        return { ...receipt.result, duplicate: true };
      }
      const copy = value => JSON.parse(JSON.stringify(value));
      const source = state.days[date] || { familyId: state.family.id, date, tasks: [] };
      if ((source.planRevision || 0) !== input.planRevision) throw Object.assign(new Error('家人已调整这天的计划，请刷新后再操作'), { code: 'CONFLICT' });
      state.family.children.forEach(child => ledgerFor(child.id));
      const ledgers = copy(state.ledgers);
      learning.generateDay(state.family, copy(state.days[today] || { date: today, tasks: [] }), ledgers);
      const task = learning.generateDay(state.family, copy(source), copy(ledgers), true).tasks.find(item => item.id === input.taskId && item.contentId === input.contentId);
      if (!task || task.version !== input.baseVersion) throw Object.assign(new Error('任务已变化，请刷新明日计划后再操作'), { code: 'CONFLICT' });
      if (task.done) throw new Error('已完成的学习记录不能删除或改期');
      let merged = false;
      if (targetDate) {
        const repeatAllowed = learning.allowsRepeat(state.family, task);
        if (!repeatAllowed && learning.wasLearned(ledgers[task.childId], task)) throw new Error('已学过这项内容，请从回顾中安排复习');
        const target = state.days[targetDate] || { familyId: state.family.id, date: targetDate, tasks: [] };
        const matches = item => item.childId === task.childId && learning.planningKey(item) === learning.planningKey(task);
        const existing = target.tasks.find(matches);
        const projected = learning.generateDay(state.family, copy(target), copy(ledgers), targetDate > today).tasks.find(matches);
        merged = Boolean(existing || projected);
        if (!existing) {
          if (projected && projected.id.startsWith('a_')) learning.omitTask(target, projected);
          target.tasks.push({ ...copy(task), id: `r_${task.childId}_${task.contentId}`, mode: task.mode === 'review' ? 'review' : 'manual', ...(repeatAllowed ? { repeatAllowed: true } : {}), version: task.version + 1, updatedBy: 'demo-parent', updatedAt: Date.now() });
          target.planRevision = (target.planRevision || 0) + 1;
        }
        state.days[targetDate] = target;
      }
      learning.omitTask(source, task); state.days[date] = source;
      state.family.scheduledContents = (state.family.scheduledContents || []).filter(item => item.date > today
        && !(item.childId === task.childId && item.date === date && (item.contentId === task.contentId || (learning.catalogById.has(item.contentId) && learning.planningKey({ id: item.contentId }) === learning.planningKey(task)))));
      if (targetDate && targetDate > today && !state.family.scheduledContents.some(item => item.childId === task.childId && item.contentId === task.contentId && item.date === targetDate)) {
        if (state.family.scheduledContents.length >= 1000) throw new Error('未来安排已达1000项，请在部分完成后再添加');
        state.family.scheduledContents.push({ childId: task.childId, contentId: task.contentId, date: targetDate });
      }
      const result = { date, ...(targetDate ? { targetDate } : {}), merged };
      state.planReceipts[input.mutationId] = { fingerprint, result };
      write(state); return { ...result, duplicate: false };
    }
    if (action === 'setTaskDone') {
      if (input.date > today) throw new Error('未来的学习安排暂不能完成');
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
      const date = action === 'assignContent' ? planDate(input.date === undefined ? today : input.date, today) : today;
      const material = action === 'assignContent' ? candidate : entry.item;
      if (action === 'assignContent' && learning.wasLearned(ledger, material)) throw new Error('已学过这项内容，请从回顾中安排复习');
      if (date > today) {
        const scheduled = (state.family.scheduledContents || []).filter(item => item.date > today);
        if (!scheduled.some(item => item.childId === input.childId && item.contentId === input.contentId && item.date === date)) {
          if (scheduled.length >= 1000) throw new Error('未来安排已达1000项，请在部分完成后再添加');
          scheduled.push({ childId: input.childId, contentId: input.contentId, date });
        }
        state.family.scheduledContents = scheduled;
      }
      const day = state.days[date] || { date, familyId: state.family.id, tasks: [] };
      let task = day.tasks.find((item) => item.childId === input.childId && learning.planningKey(item) === learning.planningKey(material));
      if (!task) {
        task = learning.taskFrom(action === 'assignContent' ? candidate : entry.item, input.childId, `r_${input.childId}_${input.contentId}`, date > today ? 'manual' : entry ? (entry.completedDates.length ? 'review' : 'manual') : 'new');
        day.tasks.push(task);
        day.planRevision = (day.planRevision || 0) + 1;
      }
      if (date === today) learning.recordTasks(ledger, day.tasks.filter((item) => item.childId === input.childId), today);
      state.days[date] = day; write(state); return { task, date };
    }
    if (action === 'addChild') {
      if (!input.name || state.family.children.length >= 5) throw new Error('请输入昵称，最多5个档案');
      state.family.children.push({ id: id(), name: input.name, ...profile(input, today), version: 0 });
    } else if (action === 'updateChild') {
      ledgerFor(input.childId);
      const child = state.family.children.find((item) => item.id === input.childId);
      if (input.baseVersion !== (child.version || 0)) { const error = new Error('档案已更新，请刷新'); error.code = 'CONFLICT'; throw error; }
      if (!input.name || !input.name.trim() || input.name.trim().length > 16) throw new Error('请填写16字以内的昵称');
      Object.assign(child, { name: input.name.trim(),
        ...profile({ ...input, birthDate: input.birthDate === undefined ? child.birthDate : input.birthDate }, today), version: (child.version || 0) + 1 });
    } else if (action === 'addPlan') {
      ledgerFor(input.childId);
      const kind = input.kind || learning.kindOf(input);
      if (!input.title || !input.title.trim() || state.family.plans.length >= 100 || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 120) throw new Error('请填写名称和1–120分钟的时长；最多100项');
      if (!learning.kinds.some((item) => item.id === kind && item.subject === input.subject)) throw new Error('请选择学习类型');
      if (input.studyGrade != null && (!Number.isInteger(input.studyGrade) || input.studyGrade < 1 || input.studyGrade > 9)) throw new Error('内容年级无效');
      const date = planDate(input.date === undefined ? today : input.date, today);
      state.family.plans.push({ id: id(), childId: input.childId, kind, subject: input.subject, title: input.title.trim(), detail: input.detail || '',
        minutes: input.minutes, enabled: true, source: '家长自建', schedule: input.schedule || 'daily', date,
        ...((input.schedule || 'daily') === 'daily' && input.date !== undefined ? { startDate: date } : {}),
        ...(input.studyGrade ? { studyGrade: input.studyGrade } : {}) });
      if (input.schedule === 'once' && learning.wasLearned(ledgerFor(input.childId), state.family.plans[state.family.plans.length - 1])) throw new Error('已学过这项内容，请从回顾中安排复习');
    } else if (action === 'saveAutoPlans') {
      ledgerFor(input.childId);
      validateRules(input.rules);
      if (state.family.templateSets && state.family.templateSets[input.childId]) {
        const set = learning.templateSet(state.family, input.childId);
        if (state.days[today]) learning.freezeTemplateDay(state.family, state.days[today], input.childId);
        set.templates.find(item => item.id === set.activeId).rules = input.rules;
        set.revision += 1; state.family.templateSets[input.childId] = set;
      }
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
