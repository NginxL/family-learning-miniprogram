import catalog = require('./catalog');
import type { AutoRule, CatalogQuery, ContentInput, ContentKind, ContentScope, Day, HistoryQuery, KindDefinition, KnowledgeItem, LearningArea, LearningContent, LearningLedger, PlanningFamily, SchoolGrade, StoredContent, SubjectFilter, Task, TaskMode, TemplateSet } from './models';
const catalogById = new Map(catalog.map((item) => [item.id, item]));
const learningAreas: Array<{ id: LearningArea; label: string }> = [
  { id: 'recitation', label: '背诵与默写' }, { id: 'classical', label: '文言理解' },
  { id: 'vocabulary', label: '词汇运用' }, { id: 'grammar', label: '英语语法' }
];
const kinds: KindDefinition[] = [
  { id: 'poetry', subject: 'poetry', label: '古诗文', unit: '首', max: 5 },
  { id: 'word', subject: 'english', label: '英语单词', unit: '个', max: 30 },
  { id: 'sentence', subject: 'english', label: '英语句子', unit: '句', max: 10 },
  { id: 'reading', subject: 'reading', label: '语文阅读', unit: '篇 / 次', max: 5 },
  { id: 'english-reading', subject: 'english', label: '英文阅读', unit: '篇', max: 5 },
  { id: 'math', subject: 'math', label: '数学', unit: '题', max: 20 },
  { id: 'other', subject: 'other', label: '其他', unit: '项', max: 10 }
];
const subjects: Array<{ id: SubjectFilter; label: string }> = [
  { id: 'all', label: '全部' }, { id: 'poetry', label: '古诗文' }, { id: 'english', label: '英语' },
  { id: 'reading', label: '语文阅读' }, { id: 'math', label: '数学' }, { id: 'other', label: '其他' }
];
const kindOf = (item: Pick<ContentInput, 'kind' | 'subject'>): ContentKind => item.kind || (item.subject === 'english' ? 'sentence' : item.subject) || 'other';
const definition = (kind: ContentKind) => kinds.find((entry) => entry.id === kind) || kinds[kinds.length - 1];
// Case is meaningful: Miss/miss and May/may are different learning content.
const normalizedTitle = (value: unknown) => String(value).trim().replace(/^读一读/, '').replace(/[《》\s]/g, '');
function contentId(item: ContentInput): string {
  if (item.contentId) return item.contentId;
  if (catalogById.has(item.id)) return item.id;
  const matches = catalog.filter((entry) => entry.kind === kindOf(item) && entry.detail === item.detail
    && [entry.title, ...(entry.aliases || [])].some((title) => normalizedTitle(title) === normalizedTitle(item.title)));
  // A matching title alone cannot turn a parent's excerpt or exercise into a whole textbook work.
  return matches.length === 1 ? matches[0].id : item.id;
}
const defaultRules = (): AutoRule[] => kinds.map<AutoRule>((kind) => ({ kind: kind.id, mode: 'new', scope: 'starter', quantity: ['poetry', 'sentence'].includes(kind.id) ? 1 : 0 }));
const emptyRules = (): AutoRule[] => kinds.map<AutoRule>((kind) => ({ kind: kind.id, mode: 'new', scope: 'starter', quantity: 0 }));
function templateSet(family: PlanningFamily, childId: string): TemplateSet {
  const id = `default_${childId}`;
  return JSON.parse(JSON.stringify(family.templateSets?.[childId] || {
    templates: [{ id, name: '每日积累', rules: family.autoPlans?.[childId] || emptyRules() }], activeId: id, revision: 0
  }));
}
function activeTemplate(family: PlanningFamily, childId: string) {
  const set = templateSet(family, childId);
  return set.templates.find((item) => item.id === set.activeId) || set.templates[0];
}
function templateForDate(family: PlanningFamily, childId: string, date: string) {
  const set = templateSet(family, childId);
  // The input is a Shanghai calendar date. UTC parsing avoids the device/server timezone shifting its weekday.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const id = set.weeklySchedule ? (weekday === 0 || weekday === 6 ? set.weeklySchedule.weekendTemplateId : set.weeklySchedule.weekdaysTemplateId) : set.activeId;
  return set.templates.find((item) => item.id === id) || set.templates.find((item) => item.id === set.activeId) || set.templates[0];
}
function templateSummary(rules: AutoRule[]): string {
  return rules.filter((rule) => rule.quantity > 0).map((rule) => {
    const kind = definition(rule.kind);
    return `${kind.label} ${rule.quantity}${kind.unit}${rule.mode === 'review' ? '（复习）' : ''}`;
  }).join(' · ') || '暂停自动安排';
}
// A changed active template never fills previously disabled types into an already-generated day.
function freezeTemplateDay(family: PlanningFamily, day: Day, childId: string): void {
  const generated = day.generated?.[childId];
  if (!generated) return;
  for (const rule of templateForDate(family, childId, day.date).rules) if (!generated[rule.kind]) generated[rule.kind] = { ...rule, actual: 0 };
}
function scopeOptions(kind: ContentKind) {
  const options: Array<{ id: ContentScope; label: string }> = [{ id: 'starter', label: '亲子入门' }];
  if (kind === 'poetry') options.push({ id: 'foundation', label: '国家课标 1–6 年级 · 75 篇' },
    { id: 'moe-all', label: '国家课标全部 · 135 篇 / 组' }, { id: 'shanghai54', label: '五四教材已整理篇目 · 部分' });
  if (kind === 'word') options.push({ id: 'foundation', label: '国家课标二级 · 505 词条' },
    { id: 'moe-all', label: '国家课标全部 · 1600 词条' }, { id: 'tables', label: '数词、月份、星期 · 77 项' });
  if (['word', 'sentence', 'reading', 'english-reading'].includes(kind)) options.push({ id: 'shanghai54', label: '上海教材关联 · 已整理部分' });
  options.push({ id: 'all', label: '全部可用内容' });
  return options;
}
const inScope = (item: { collections?: ContentScope[] }, scope: ContentScope) => scope === 'all' || (item.collections || []).includes(scope);
function content(item: ContentInput): LearningContent {
  if (item.builtin && catalogById.has(item.id)) item = catalogById.get(item.id)!;
  const kind = kindOf(item);
  const id = contentId(item);
  let workId = item.workId;
  if (!workId && !catalogById.has(id)) {
    const matches = catalog.filter((entry) => entry.kind === kind && [entry.title, ...(entry.aliases || [])].some((title) => normalizedTitle(title) === normalizedTitle(item.title)));
    // A title can conservatively avoid another "new" work, but grants no textbook completion credit.
    if (matches.length === 1) workId = matches[0].workId || matches[0].id;
  }
  return { id, kind, subject: definition(kind).subject, title: item.title!,
    detail: item.detail || '', source: item.source || '家长自建', minutes: item.minutes || 5,
    ...(workId ? { workId } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(item.studyGrade ? { studyGrade: item.studyGrade } : {}) };
}
function storedContent(item: ContentInput): StoredContent {
  const full = content(item); const builtin = catalogById.get(full.id);
  // Built-in bodies stay in the versioned app catalogue, not copied into every child's ledger.
  // Day snapshots still keep the exact text that the child received that day.
  return builtin && full.detail === builtin.detail && !full.studyGrade ? { id: full.id, kind: full.kind, builtin: true } : full;
}
function recordTasks(ledger: LearningLedger, tasks: Task[], date: string): void {
  tasks.forEach((task) => {
    const id = contentId(task);
    const entry = ledger.records[id] || { item: storedContent(task), firstSeen: date, lastSeen: date, completedDates: [], mastered: false, version: 0 };
    if (!entry.item.builtin) entry.item = storedContent(entry.item);
    entry.firstSeen = entry.firstSeen < date ? entry.firstSeen : date;
    entry.lastSeen = entry.lastSeen > date ? entry.lastSeen : date;
    // No inference from a check-in to mastery. Undo only removes this date's completion.
    const done = tasks.some((other) => contentId(other) === id && other.done);
    const had = entry.completedDates.includes(date);
    if (done !== had) {
      entry.completedDates = done ? [...entry.completedDates, date].sort() : entry.completedDates.filter((value) => value !== date);
      if (!entry.completedDates.length) entry.mastered = false;
      entry.version += 1;
    }
    ledger.records[id] = entry;
  });
}
function taskFrom(item: ContentInput, childId: string, id: string, mode: TaskMode): Task {
  return { ...content(item), id, contentId: contentId(item), childId, mode, done: false, version: 0, updatedBy: null, updatedAt: null };
}
function materialPool(family: PlanningFamily, childId: string, scope: ContentScope = 'all') {
  const custom = family.plans.filter((plan) => plan.childId === childId && plan.enabled && plan.schedule === 'library');
  return [...new Map([...catalog.filter((item) => !item.manualOnly && inScope(item, scope)), ...custom.map(content)].map((item) => [item.id, item])).values()];
}
// Catalogue excerpts share a work; custom exercises need matching text, not just matching titles.
function planningKey(item: ContentInput): string {
  const builtin = catalogById.get(contentId(item));
  if (builtin) return `work:${builtin.workId || builtin.id}`;
  const compact = (value: string) => value.trim().replace(/\s+/g, ' ');
  return JSON.stringify([kindOf(item), normalizedTitle(item.title), compact(item.detail || '')]);
}
function coveredIds(item: ContentInput): string[] {
  const builtin = catalogById.get(contentId(item));
  const ids = builtin?.coveredContentIds || [];
  if (!ids.length) return [];
  if (item.builtin || item.detail === undefined || item.detail === builtin?.detail) return ids;
  // An old full-text snapshot can differ in punctuation. A shortened/custom
  // snapshot must actually contain a chapter before it grants chapter credit.
  const compact = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '');
  const detail = compact(item.detail);
  return ids.filter(id => {
    const child = catalogById.get(id)!;
    const body = child.author ? child.detail.slice(child.author.length) : child.detail;
    return detail.includes(compact(body));
  });
}
function planningKeys(item: ContentInput): string[] {
  return [planningKey(item), ...coveredIds(item).map(id => planningKey({ id }))];
}
const overlapsKeys = (keys: Set<string>, item: ContentInput) => planningKeys(item).some(key => keys.has(key));
function wasLearned(ledger: LearningLedger, item: ContentInput): boolean {
  const keys = new Set(planningKeys(item));
  return Object.values(ledger.records).some((entry) => entry.completedDates.length > 0 && overlapsKeys(keys, entry.item));
}
function allowsRepeat(family: PlanningFamily, task: Task): boolean {
  return task.mode === 'review' || task.repeatAllowed === true || family.plans.some((plan) => plan.id === task.id
    && plan.childId === task.childId && (!plan.schedule || plan.schedule === 'daily'));
}
function omitTask(day: Day, task: Task): void {
  const key = planningKey(task);
  day.tasks = day.tasks.filter((item) => item.done || item.childId !== task.childId || planningKey(item) !== key);
  day.omitted = day.omitted || [];
  if (!day.omitted.some((item) => item.childId === task.childId && item.key === key)) {
    day.omitted.push({ childId: task.childId, key, kind: task.kind, automatic: task.id.startsWith('a_') });
  }
  day.planRevision = (day.planRevision || 0) + 1;
}
function generateDay(family: PlanningFamily, day: Day, ledgers: Record<string, LearningLedger>, preview = false): Day {
  const filterPlanned = preview || !day.generated;
  const learnedKeys = new Map(family.children.map((child) => [child.id, new Set(Object.values(ledgers[child.id].records)
    .filter((entry) => entry.completedDates.length).flatMap((entry) => planningKeys(entry.item)))]));
  const doneKeys = new Set(day.tasks.filter((task) => task.done).flatMap((task) => planningKeys(task).map(key => JSON.stringify([task.childId, key]))));
  const pendingKeys = new Set<string>();
  // Completed snapshots are immutable here, even if old versions stored duplicates.
  day.tasks = day.tasks.filter((task) => {
    if (task.done) return true;
    const keys = planningKeys(task).map(key => JSON.stringify([task.childId, key]));
    if (keys.some(key => doneKeys.has(key) || pendingKeys.has(key))) return false;
    if (filterPlanned && !allowsRepeat(family, task) && overlapsKeys(learnedKeys.get(task.childId) || new Set(), task)) return false;
    keys.forEach(key => pendingKeys.add(key)); return true;
  });
  day.generated = day.generated || {};
  day.warnings = day.warnings || [];
  family.children.forEach((child) => {
    const ledger = ledgers[child.id];
    const omitted = (day.omitted || []).filter((item) => item.childId === child.id);
    const omittedKeys = new Set(omitted.map((item) => item.key));
    const assignedKeys = new Set(day.tasks.filter((task) => task.childId === child.id).flatMap(planningKeys));
    recordTasks(ledger, day.tasks.filter((task) => task.childId === child.id), day.date);
    // Existing plans without a schedule preserve the v0.1 daily-repeat semantics.
    family.plans.filter((plan) => plan.childId === child.id && plan.enabled && plan.schedule !== 'library'
      && (!plan.startDate || plan.startDate <= day.date)
      && (plan.schedule !== 'once' || plan.date === day.date)).forEach((plan) => {
      const key = planningKey(plan);
      if (!overlapsKeys(assignedKeys, plan) && !omittedKeys.has(key) && (plan.schedule !== 'once' || !overlapsKeys(learnedKeys.get(child.id) || new Set(), plan))) {
        day.tasks.push(taskFrom(plan, child.id, plan.id, 'manual'));
        planningKeys(plan).forEach(key => assignedKeys.add(key));
      }
    });
    recordTasks(ledger, day.tasks.filter((task) => task.childId === child.id), day.date);
    const generated = day.generated![child.id] || {};
    // Explicit future dates reserve a work without claiming it has been studied.
    const reserved = new Set([
      ...(family.scheduledContents || []).filter((item) => item.childId === child.id && item.date > day.date).map((item) => item.contentId),
      ...family.plans.filter((plan) => plan.childId === child.id && plan.enabled && plan.schedule === 'once' && plan.date && plan.date > day.date).map(contentId)
    ].flatMap(id => planningKeys({ id })));
    const rules = templateForDate(family, child.id, day.date).rules;
    rules.filter((rule) => rule.quantity > 0 || family.templateSets?.[child.id]).forEach((rule) => {
      if (generated[rule.kind]) return;
      let pool;
      if (rule.mode === 'new') {
        const seenWorks = new Set(Object.values(ledger.records).map((entry) => { const item = content(entry.item); return item.workId || item.id; }));
        const seenKeys = new Set(Object.values(ledger.records).flatMap((entry) => planningKeys(entry.item)));
        pool = materialPool(family, child.id, rule.scope || 'starter').filter((item) => item.kind === rule.kind && !seenWorks.has(item.workId || item.id) && !overlapsKeys(seenKeys, item));
        // A work and its textbook excerpt are separate study units, but are not new twice.
        const selectedWorks = new Set<string>();
        pool = pool.filter((item) => { if (overlapsKeys(selectedWorks, item)) return false; planningKeys(item).forEach(key => selectedWorks.add(key)); return true; });
      } else {
        pool = Object.values(ledger.records).filter((entry) => entry.item.kind === rule.kind && entry.completedDates.length)
          .sort((a, b) => a.completedDates[a.completedDates.length - 1].localeCompare(b.completedDates[b.completedDates.length - 1]) || a.item.id.localeCompare(b.item.id))
          .map((entry) => content(entry.item)).filter((item) => !catalogById.has(item.id) || inScope(catalogById.get(item.id)!, rule.scope || 'starter'));
      }
      const quantity = Math.max(0, rule.quantity - omitted.filter((item) => item.kind === rule.kind && item.automatic).length);
      const chosen = [];
      for (const item of pool) {
        const key = planningKey(item);
        if (chosen.length >= quantity) break;
        if (overlapsKeys(assignedKeys, item) || omittedKeys.has(key) || overlapsKeys(reserved, item)) continue;
        chosen.push(item); planningKeys(item).forEach(key => assignedKeys.add(key));
      }
      chosen.forEach((item) => day.tasks.push(taskFrom(item, child.id, `a_${child.id}_${item.id}`, rule.mode)));
      generated[rule.kind] = { ...rule, actual: chosen.length };
      if (chosen.length < quantity) day.warnings!.push({ childId: child.id, kind: rule.kind,
        message: `${definition(rule.kind).label}：计划 ${quantity}，已安排 ${chosen.length}。${rule.mode === 'new' ? '全新内容不足，可在明日计划里补充内容库或改为复习。' : '可复习内容不足，完成学习后再安排复习。'}` });
    });
    day.generated![child.id] = generated;
    recordTasks(ledger, day.tasks.filter((task) => task.childId === child.id), day.date);
  });
  return day;
}
// A compact, complete index for the library; no pagination or learning text is sent.
function learningStatus(ledger: LearningLedger) {
  const completed = new Map<string, { dates: Set<string>; mastered: boolean }>();
  for (const entry of Object.values(ledger.records).filter(entry => entry.completedDates.length > 0)) {
    for (const id of [entry.item.id, ...coveredIds(entry.item)]) {
      const state = completed.get(id) || { dates: new Set<string>(), mastered: false };
      entry.completedDates.forEach(date => state.dates.add(date));
      // Derived chapter completion never invents a mastery choice or a stored record.
      if (id === entry.item.id) state.mastered = entry.mastered;
      completed.set(id, state);
    }
  }
  return { items: [...completed].map(([contentId, state]) => ({ contentId, learnedCount: state.dates.size,
    lastLearned: [...state.dates].sort().slice(-1)[0], mastered: state.mastered })) };
}
function history(ledger: LearningLedger, input: HistoryQuery = {}) {
  const subject = input.subject || 'all'; const filter = input.filter || 'learned';
  const query = (input.query || '').trim().toLowerCase();
  const entries = Object.values(ledger.records).map((entry) => ({ ...content(entry.item), contentId: entry.item.id,
    firstSeen: entry.firstSeen, lastSeen: entry.lastSeen, lastLearned: entry.completedDates[entry.completedDates.length - 1] || '',
    learnedCount: entry.completedDates.length, mastered: entry.mastered, version: entry.version }));
  const filtered = entries.filter((entry) => (subject === 'all' || entry.subject === subject)
    && (filter === 'all' || (filter === 'mastered' ? entry.mastered : entry.learnedCount > 0))
    && (!query || `${entry.title} ${entry.detail}`.toLowerCase().includes(query)))
    .sort((a, b) => (b.lastLearned || b.lastSeen).localeCompare(a.lastLearned || a.lastSeen) || a.id.localeCompare(b.id));
  const offset = Number(input.offset) || 0; const limit = 30;
  return { items: filtered.slice(offset, offset + limit), total: filtered.length,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    stats: { seen: entries.length, learned: entries.filter((entry) => entry.learnedCount > 0).length, mastered: entries.filter((entry) => entry.mastered).length } };
}
function ruleRows(family: PlanningFamily, childId: string, rules: AutoRule[] = activeTemplate(family, childId).rules) {
  return kinds.map((kind) => {
    const rule: Omit<AutoRule, 'kind'> = { mode: 'new', quantity: 0, scope: 'starter', ...(rules.find((item) => item.kind === kind.id) || {}) };
    const scopes = scopeOptions(kind.id);
    return { ...kind, ...rule, scopes, scopeIndex: Math.max(0, scopes.findIndex((scope) => scope.id === rule.scope)),
      poolCount: materialPool(family, childId, rule.scope).filter((item) => item.kind === kind.id).length };
  });
}
function searchCatalog(input: CatalogQuery = {}) {
  const query = (input.query || '').trim().toLowerCase();
  // Retain legacy math IDs for saved tasks/history, but remove them from the selectable library.
  return catalog.filter((item) => item.kind !== 'math' && (!input.kind || item.kind === input.kind)
    && (!input.learningArea || item.learningArea === input.learningArea)
    && (!input.subject || input.subject === 'all' || definition(item.kind).subject === input.subject)
    && (!input.scope || inScope(item, input.scope)) && (!input.bookId || (item.bookIds || []).includes(input.bookId))
    && (!(input.grade || input.semester || input.unitId) || (item.gradeMappings || []).some((mapping) =>
      (!input.grade || mapping.grade === input.grade) && (!input.semester || mapping.semester === input.semester)
      && (!input.bookId || mapping.bookId === input.bookId) && (!input.unitId || mapping.unitId === input.unitId)
      && mapping.schoolSystem === '5-4' && mapping.status === 'catalogue_verified'))
    && (!query || `${item.title} ${item.author || ''} ${item.dynasty || ''} ${item.detail}`.toLowerCase().includes(query)));
}
const gradeLabels = ['未设置', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级（预备）', '七年级', '八年级', '九年级'];
function knowledgeGradeLabel(item: KnowledgeItem): string {
  if (item.gradeMappings?.length) return [...new Set(item.gradeMappings.map(mapping => `${gradeLabels[mapping.grade]}${mapping.semester}${mapping.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}`))].join('、')
    + (item.gradeMappings.every(mapping => mapping.mappingType === 'aligned_practice') ? ' · 原创配套练习' : ' · 教材归属已核实');
  if (item.learningArea) return '课标基础知识 · 教材年级、学期待核实';
  if (item.kind === 'word' && item.collections.includes('moe-all')) return '国家课标词表 · 教材年级、学期待核实';
  if (item.kind === 'word' && item.collections.includes('tables')) return '国家课标另列表 · 教材年级、学期待核实';
  return ['reading', 'english-reading'].includes(item.kind) ? '自编入门练习 · 非教材课文' : '年级归属待核对';
}
function progress(ledger: LearningLedger) {
  const records = Object.values(ledger.records);
  const statuses = new Map(learningStatus(ledger).items.map(item => [item.contentId, item]));
  const learned = (id: string) => statuses.has(id);
  const mastered = (id: string) => Boolean(statuses.get(id)?.mastered);
  const count = (items: Array<{ id: string }>) => ({ total: items.length, learned: items.filter((item) => learned(item.id)).length, mastered: items.filter((item) => mastered(item.id)).length });
  const grades = Array.from({ length: 9 }, (_, index) => {
    const grade = (index + 1) as SchoolGrade;
    const gradeItems = catalog.filter((item) => (item.gradeMappings || []).some((mapping) => mapping.grade === grade && mapping.schoolSystem === '5-4' && mapping.status === 'catalogue_verified'));
    const items = gradeItems.filter(item => item.gradeMappings!.some(mapping => mapping.grade === grade && mapping.mappingType !== 'aligned_practice'));
    const practiceItems = gradeItems.filter(item => !items.includes(item));
    const stats = count(items);
    const parentItems = records.filter((entry) => entry.item.studyGrade === grade);
    return { grade, label: gradeLabels[grade], stage: grade <= 5 ? '小学' : '初中', ...stats, practice: count(practiceItems),
      parentLearned: parentItems.filter((entry) => entry.completedDates.length).length,
      parentMastered: parentItems.filter((entry) => entry.completedDates.length && entry.mastered).length,
      coverage: items.length ? 'partial' : 'unverified', fullGradeComplete: false };
  });
  const classified = new Set(catalog.filter((item) => (item.gradeMappings || []).some((mapping) => mapping.status === 'catalogue_verified')).map((item) => item.id));
  return {
    stats: { learned: records.filter((entry) => entry.completedDates.length).length, mastered: records.filter((entry) => entry.completedDates.length && entry.mastered).length },
    subjects: subjects.filter((subject) => subject.id !== 'all').map((subject) => ({ ...subject,
      learned: records.filter((entry) => entry.completedDates.length && definition(entry.item.kind).subject === subject.id).length,
      mastered: records.filter((entry) => entry.completedDates.length && entry.mastered && definition(entry.item.kind).subject === subject.id).length })),
    foundations: [
      { label: '国家课标古诗文 1–6 年级', ...count(searchCatalog({ kind: 'poetry', scope: 'foundation' })) },
      { label: '国家英语课标二级词条', ...count(searchCatalog({ kind: 'word', scope: 'foundation' })) }
    ],
    grades, highestGradeStarted: Math.max(0, ...grades.filter((grade) => grade.learned > 0).map((grade) => grade.grade)),
    unclassifiedLearned: records.filter((entry) => entry.completedDates.length && !classified.has(entry.item.id)).length,
    coverageNote: '上海五四制：小学一至五年级，六年级为初中预备年级。教材字词、古诗与单元原创练习分别统计，学校实际使用版次待确认；未核全年级不计算完成率或推断已学完。'
  };
}
export { catalog, catalogById, kinds, subjects, kindOf, definition, contentId, content, defaultRules, emptyRules,
  scopeOptions, inScope, materialPool, recordTasks, taskFrom, generateDay, history, ruleRows, searchCatalog, gradeLabels, progress,
  learningAreas, knowledgeGradeLabel,
  planningKey, wasLearned, omitTask, allowsRepeat, templateSet, activeTemplate, templateForDate, templateSummary, freezeTemplateDay, learningStatus };
