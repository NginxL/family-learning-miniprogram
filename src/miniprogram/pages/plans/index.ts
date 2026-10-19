import { common } from '../../lib/page';
import { groupTasks } from '../../lib/task-groups';
import { shiftDate } from '../../lib/sync-engine';
import { errorDetails } from '../../lib/errors';
import { openContentDetail } from '../../lib/content-detail';
import { openLearningPage } from '../../lib/learning-navigation';
import * as learning from '../../lib/learning/learning';
import type { AutoRule, ContentKind, SchoolGrade, SubjectFilter, Task, DailyTemplate } from '../../../shared/models';
import type { ApiPayloads } from '../../../shared/api';
import type { LearningApp, ClientFamily } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, FieldEvent, PageDefinition, PickerEvent, ValueEvent } from '../../lib/page-types';
export type RuleDraft = Omit<ReturnType<typeof learning.ruleRows>[number], 'quantity'> & { quantity: number | '' };
interface ScheduleDraft { familyId: string; childId: string; baseRevision: number; weekly: boolean; activeId: string; weekdaysTemplateId: string; weekendTemplateId: string }
type ScheduleSlot = 'activeId' | 'weekdaysTemplateId' | 'weekendTemplateId';
export interface PlansData extends CommonData {
  recitationPolicies: string[];
  editor: 'preview' | 'auto' | 'manual'; kinds: typeof learning.kinds; kindIndex: number;
  schedules: string[]; scheduleIndex: number; modes: string[]; rules: RuleDraft[];
  formTitle: string; formDetail: string; formMinutes: string; draftDirty: boolean;
  studyGrade: SchoolGrade | 0; gradeLabels: string[]; visibleRules?: RuleDraft[]; dailyCount?: number;
  groups: Array<Omit<ReturnType<typeof groupTasks<Decorated<Task>>>[number], 'items'>>;
  planDate: string; maxPlanDate: string; previewReady: boolean;
  templates: Array<DailyTemplate & { label: string }>; templateId: string; templateName: string; templateIndex: number;
  activeTemplateId: string; activeTemplateName: string; activeTemplateSummary: string;
  templateRevision: number; draftTemplateRevision: number; templateConflict: boolean; newTemplateDraft: boolean;
  previewTemplateId: string; previewTemplateName: string; previewTemplateSummary: string; weeklyEnabled: boolean; weekdayLabel: string;
  templateAdvanced: boolean; templateCanDelete: boolean; scheduleDraft: ScheduleDraft | null; scheduleConflict: boolean;
  scheduleRows: Array<{ slot: ScheduleSlot; label: string; index: number }>;
}
export interface PlansMethods extends CommonMethods {
  afterRender(): void; updateVisibleRules(): void;
  changeEditor(event: DatasetEvent<{ id: PlansData['editor'] }>): void;
  changeKind(event: PickerEvent): void; changeSchedule(event: PickerEvent): void; changeStudyGrade(event: PickerEvent): void;
  changePlanDate(event: ValueEvent): void; openGroup(event: DatasetEvent): void; openPlan(event: DatasetEvent): void;
  updateRule(kind: ContentKind, patch: Partial<Pick<RuleDraft, 'mode' | 'scope' | 'quantity' | 'recitationPolicy'>>): void;
  changeRecitationPolicy(event: PickerEvent): void;
  changeMode(event: FieldEvent<string | number, { id: ContentKind }>): void;
  changeScope(event: FieldEvent<string | number, { id: ContentKind }>): void;
  browseRule(event: DatasetEvent<{ id: ContentKind }>): void;
  changeQuantity(event: FieldEvent<string, { id: ContentKind }>): void;
  stepQuantity(event: DatasetEvent<{ id: ContentKind; step: string | number }>): void;
  resetRules(): void; loadTemplate(id?: string): void; openTemplate(): void;
  selectTemplate(event: PickerEvent): void; createTemplate(): void; changeTemplateName(event: ValueEvent): void;
  saveTemplate(): Promise<void>; saveAndUseTemplate(): Promise<void>; activateTemplate(): Promise<void>; deleteTemplate(): Promise<void>;
  applyTemplate(action: 'saveDailyTemplate' | 'activateDailyTemplate' | 'deleteDailyTemplate', activate?: boolean): Promise<void>;
  toggleTemplateAdvanced(): void; adoptTemplates(family: ClientFamily, childId: string): void;
  openSchedule(): void; closeSchedule(): void; changeWeekly(event: ValueEvent<boolean>): void;
  chooseScheduleTemplate(event: FieldEvent<string | number, { slot: ScheduleSlot }>): void; saveSchedule(): Promise<void>;
  addPlan(event: ValueEvent<{ title: string; detail: string; minutes: string }>): Promise<void>;
  togglePlan(event: FieldEvent<boolean, { id: string }>): Promise<void>;
}
interface PlansRuntime extends CommonRuntime { draftScope?: string; templateMutation?: { fingerprint: string; id: string; uncertain?: boolean }; scheduleMutation?: { fingerprint: string; id: string; uncertain?: boolean }; lastSubject?: SubjectFilter; defaultPlanDate?: string; openingGroup?: boolean }
const base = common();
const definition: PageDefinition<PlansData, PlansMethods, PlansRuntime> = {
  ...base,
  data: { ...base.data, followToday: false, followTomorrow: true, editor: 'preview', kinds: learning.kinds, kindIndex: 0, schedules: ['仅指定日期', '从指定日期起每天固定', '加入自动内容库'], scheduleIndex: 0,
    recitationPolicies: ['全部古诗文', '优先教材必背', '只选教材必背'], modes: ['全新', '复习'], rules: [], formTitle: '', formDetail: '', formMinutes: '5', draftDirty: false,
    studyGrade: 0, gradeLabels: learning.gradeLabels, groups: [],
    planDate: '', maxPlanDate: '', previewReady: false,
    templates: [], templateId: '', templateName: '', templateIndex: 0, activeTemplateId: '', activeTemplateName: '', activeTemplateSummary: '',
    templateRevision: 0, draftTemplateRevision: 0, templateConflict: false, newTemplateDraft: false,
    previewTemplateId: '', previewTemplateName: '', previewTemplateSummary: '', weeklyEnabled: false, weekdayLabel: '',
    templateAdvanced: false, templateCanDelete: false, scheduleDraft: null, scheduleConflict: false, scheduleRows: [] },
  onHide() { this.setData({ scheduleDraft: null }); base.onHide.call(this); },
  render() { this.setData({ subjectFilter: 'all' }); base.render.call(this); },
  afterRender() {
    if (this.defaultPlanDate !== this.data.date) {
      this.defaultPlanDate = this.data.date; this.setData({ planDate: this.data.date, maxPlanDate: shiftDate(this.data.today, 365) });
    }
    this.setData({ groups: groupTasks(this.data.tasks).map(({ items, ...group }) => group),
      previewReady: Boolean(this.data.family && this.engine.state.days[`${this.data.family.id}:${this.data.date}`]) });
    if (!this.data.family) { this.draftScope = ''; this.setData({ rules: [], templates: [], templateName: '', draftDirty: false, scheduleDraft: null }); return; }
    const set = learning.templateSet(this.data.family, this.data.childId);
    const active = set.templates.find((item) => item.id === set.activeId)!;
    const preview = learning.templateForDate(this.data.family, this.data.childId, this.data.date);
    this.setData({ templates: set.templates.map((item) => ({ ...item, label: item.name + (set.weeklySchedule
      ? [set.weeklySchedule.weekdaysTemplateId, set.weeklySchedule.weekendTemplateId].includes(item.id) ? ' · 已安排' : ''
      : item.id === set.activeId ? ' · 每天使用' : '') })),
      activeTemplateId: active.id, activeTemplateName: active.name, activeTemplateSummary: learning.templateSummary(active.rules), templateRevision: set.revision,
      previewTemplateId: preview.id, previewTemplateName: preview.name, previewTemplateSummary: learning.templateSummary(preview.rules), weeklyEnabled: Boolean(set.weeklySchedule),
      weekdayLabel: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${this.data.date}T00:00:00Z`).getUTCDay()] });
    const scope = `${this.engine.state.userId}:${this.data.family.myRole}:${this.data.family.id}:${this.data.childId}`;
    if (this.draftScope !== scope) { this.draftScope = scope; this.setData({ scheduleDraft: null, templateAdvanced: false }); this.loadTemplate(preview.id); }
    else if (!this.data.draftDirty && !this.data.busy && !this.templateMutation?.uncertain) this.loadTemplate(this.data.templateId);
    else this.setData({ templateConflict: set.revision !== this.data.draftTemplateRevision && !this.templateMutation?.uncertain });
    const schedule = this.data.scheduleDraft;
    if (schedule) this.setData({ scheduleConflict: set.revision !== schedule.baseRevision && !this.scheduleMutation?.uncertain,
      scheduleRows: (schedule.weekly ? [{ slot: 'weekdaysTemplateId' as const, label: '周一至周五' }, { slot: 'weekendTemplateId' as const, label: '周六、周日' }]
        : [{ slot: 'activeId' as const, label: '每天使用' }]).map((row) => ({ ...row, index: set.templates.findIndex((item) => item.id === schedule[row.slot]) })) });
    this.updateVisibleRules();
    if (this.lastSubject !== this.data.subjectFilter) {
      this.lastSubject = this.data.subjectFilter;
      const index = learning.kinds.findIndex((kind) => kind.subject === this.data.subjectFilter);
      if (index >= 0) this.setData({ kindIndex: index });
    }
  },
  updateVisibleRules() {
    const set = this.data.family && learning.templateSet(this.data.family, this.data.childId);
    this.setData({ visibleRules: this.data.rules.filter((rule) => !['math', 'other'].includes(rule.id) || Number(rule.quantity) > 0), dailyCount: this.data.rules.reduce((sum, rule) => sum + (Number(rule.quantity) || 0), 0),
      templateCanDelete: Boolean(set && !this.data.newTemplateDraft && set.activeId !== this.data.templateId
        && ![set.weeklySchedule?.weekdaysTemplateId, set.weeklySchedule?.weekendTemplateId].includes(this.data.templateId)) });
  },
  changeEditor(event) { this.setData({ editor: event.currentTarget.dataset.id }); },
  loadTemplate(id) {
    if (!this.data.family) return;
    const set = learning.templateSet(this.data.family, this.data.childId);
    const template = set.templates.find((item) => item.id === id) || set.templates.find((item) => item.id === set.activeId)!;
    this.templateMutation = undefined;
    this.setData({ templateId: template.id, templateName: template.name, templateIndex: set.templates.findIndex((item) => item.id === template.id),
      rules: learning.ruleRows(this.data.family, this.data.childId, template.rules), draftDirty: false, newTemplateDraft: false,
      draftTemplateRevision: set.revision, templateConflict: false });
    this.updateVisibleRules();
  },
  openTemplate() { if (!this.data.draftDirty) this.loadTemplate(this.data.previewTemplateId); this.setData({ editor: 'auto' }); },
  toggleTemplateAdvanced() { this.setData({ templateAdvanced: !this.data.templateAdvanced }); },
  adoptTemplates(result, childId) {
    const family = this.engine.state.family;
    const confirmed = learning.templateSet(result, childId);
    if (family?.id === result.id && learning.templateSet(family, childId).revision < confirmed.revision)
      this.engine.save({ ...this.engine.state, family: { ...family,
        templateSets: { ...family.templateSets, [childId]: confirmed },
        autoPlans: { ...family.autoPlans, [childId]: confirmed.templates.find((item) => item.id === confirmed.activeId)!.rules } } });
  },
  openSchedule() {
    if (this.data.busy || this.data.isChild || !this.data.family) return;
    if (this.data.draftDirty) { this.setData({ editor: 'auto' }); wx.showToast({ title: '请先保存或放弃模板修改', icon: 'none' }); return; }
    const set = learning.templateSet(this.data.family, this.data.childId);
    this.scheduleMutation = undefined;
    this.setData({ scheduleDraft: { familyId: this.data.family.id, childId: this.data.childId, baseRevision: set.revision, activeId: set.activeId,
      weekly: Boolean(set.weeklySchedule), weekdaysTemplateId: set.weeklySchedule?.weekdaysTemplateId || set.activeId,
      weekendTemplateId: set.weeklySchedule?.weekendTemplateId || set.activeId }, scheduleConflict: false });
    this.render();
  },
  closeSchedule() { if (!this.data.busy) this.setData({ scheduleDraft: null }); },
  changeWeekly(event) {
    if (!this.data.busy && !this.data.isChild && this.data.scheduleDraft) {
      this.setData({ scheduleDraft: { ...this.data.scheduleDraft, weekly: event.detail.value } }); this.render();
    }
  },
  chooseScheduleTemplate(event) {
    const template = this.data.templates[Number(event.detail.value)];
    const slot = event.currentTarget.dataset.slot;
    if (template && this.data.scheduleDraft && !this.data.busy && !this.data.isChild) {
      this.setData({ scheduleDraft: { ...this.data.scheduleDraft, [slot]: template.id } }); this.render();
    }
  },
  async saveSchedule() {
    const target = this.data.scheduleDraft;
    if (!target || this.data.busy || this.data.isChild || this.data.family?.id !== target.familyId || this.data.childId !== target.childId) return;
    if (this.data.scheduleConflict) { wx.showToast({ title: '请重新载入家人更新后的安排', icon: 'none' }); return; }
    const values = { childId: target.childId, activeId: target.activeId, baseRevision: target.baseRevision,
      weeklySchedule: target.weekly ? { weekdaysTemplateId: target.weekdaysTemplateId, weekendTemplateId: target.weekendTemplateId } : null };
    const fingerprint = JSON.stringify([target.familyId, values]);
    if (this.scheduleMutation?.fingerprint !== fingerprint) this.scheduleMutation = { fingerprint, id: this.engine.makeId() };
    const userId = this.engine.state.userId; const role = this.engine.state.family?.myRole;
    this.setData({ busy: true });
    try {
      const result = await this.engine.command('saveTemplateSchedule', { ...values, mutationId: this.scheduleMutation.id });
      if (this.engine.state.userId === userId && this.engine.state.family?.myRole === role && this.data.scheduleDraft === target
        && this.data.family?.id === target.familyId && this.data.childId === target.childId) {
        this.adoptTemplates(result.family, target.childId);
        this.setData({ scheduleDraft: null });
        this.loadTemplate(learning.templateForDate(this.engine.state.family!, target.childId, this.data.date).id);
        wx.showToast({ title: target.weekly ? '已保存，每周自动安排' : '已保存，每天使用同一模板', icon: 'none' });
      }
    } catch (cause) {
      const error = errorDetails(cause);
      if (this.scheduleMutation) this.scheduleMutation.uncertain = !['CONFLICT', 'INVALID', 'FORBIDDEN', 'PARENT_REQUIRED', 'NOT_FOUND'].includes(error.code || '');
      if (error.code === 'CONFLICT' && this.data.scheduleDraft === target) this.setData({ scheduleConflict: true });
      if (this.active) wx.showToast({ title: error.message || '安排保存失败，请重试', icon: 'none', duration: 3000 });
    } finally { this.setData({ busy: false }); this.render(); }
    await this.refresh();
  },
  selectTemplate(event) {
    if (this.data.busy || this.data.isChild) return;
    if (this.data.draftDirty) { wx.showToast({ title: '请先保存或放弃当前修改', icon: 'none' }); return; }
    const template = this.data.templates[Number(event.detail.value)]; if (template) this.loadTemplate(template.id);
  },
  createTemplate() {
    if (this.data.busy || this.data.isChild || !this.data.family) return;
    if (this.data.draftDirty) { wx.showToast({ title: '请先保存或放弃当前修改', icon: 'none' }); return; }
    if (this.data.templates.length >= 10) { wx.showToast({ title: '最多10个模板，请先删除闲置模板', icon: 'none' }); return; }
    this.templateMutation = undefined;
    this.setData({ templateId: `t_${this.engine.makeId()}`, templateName: '', newTemplateDraft: true, draftDirty: true,
      draftTemplateRevision: this.data.templateRevision, templateConflict: false });
  },
  changeTemplateName(event) { if (!this.data.busy && !this.data.isChild) this.setData({ templateName: event.detail.value, draftDirty: true }); },
  openLibrary() {
    this.rememberSelection(); getApp<LearningApp>().navigation!.libraryDate = this.data.date;
    wx.switchTab({ url: '/pages/library/index' });
  },
  changePlanDate(event) { this.setData({ planDate: event.detail.value }); },
  openGroup(event) {
    const group = this.data.groups.find(item => item.id === event.currentTarget.dataset.id);
    const family = this.engine.snapshot().family;
    if (this.openingGroup || !group || !family || family.id !== this.data.family?.id
      || !family.children.some(child => child.id === this.data.childId)) return;
    const query = Object.entries({ familyId: family.id, childId: this.data.childId, date: this.data.date, kind: group.id, view: 'plan' })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    this.openingGroup = true;
    openLearningPage(`/pages/study/index?${query}`, {
      complete: () => { this.openingGroup = false; } });
  },
  openPlan(event) {
    const plan = this.data.plans.find(item => item.id === event.currentTarget.dataset.id);
    if (!plan || this.engine.snapshot().family?.id !== this.data.family?.id) return;
    openContentDetail('plan', plan, this.data.childId, { status: plan.enabled ? '已启用' : '已暂停', contextLabel: plan.scheduleLabel });
  },
  changeKind(event) { this.setData({ kindIndex: Number(event.detail.value) }); },
  changeSchedule(event) { this.setData({ scheduleIndex: Number(event.detail.value) }); },
  changeStudyGrade(event) { this.setData({ studyGrade: Number(event.detail.value) as SchoolGrade | 0 }); },
  updateRule(kind, patch) {
    if (this.data.busy || this.data.isChild) return;
    this.setData({ rules: this.data.rules.map((rule) => {
      if (rule.id !== kind) return rule;
      const next = { ...rule, ...patch };
      next.scopeIndex = next.scopes.findIndex((scope) => scope.id === next.scope);
      next.recitationPolicyIndex = ['all', 'first', 'only'].indexOf(next.recitationPolicy);
      next.poolCount = learning.recitationPool(learning.materialPool(this.data.family!, this.data.childId, next.scope).filter((item) => item.kind === kind), next.recitationPolicy).length;
      return next;
    }), draftDirty: true });
    this.updateVisibleRules();
  },
  changeRecitationPolicy(event) {
    const policy = (['all', 'first', 'only'] as const)[Number(event.detail.value)];
    if (policy) this.updateRule('poetry', { recitationPolicy: policy });
  },
  changeMode(event) { this.updateRule(event.currentTarget.dataset.id, { mode: (['new', 'review'] as const)[Number(event.detail.value)] }); },
  changeScope(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.updateRule(rule.id, { scope: rule.scopes[Number(event.detail.value)].id });
  },
  browseRule(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.rememberSelection(); getApp<LearningApp>().navigation!.libraryKind = rule.id; getApp<LearningApp>().navigation!.libraryScope = rule.scope;
    getApp<LearningApp>().navigation!.libraryRecitation = rule.id === 'poetry' && rule.recitationPolicy === 'only' ? 'required' : undefined;
    wx.switchTab({ url: '/pages/library/index' });
  },
  changeQuantity(event) { this.updateRule(event.currentTarget.dataset.id, { quantity: event.detail.value === '' ? '' : Number(event.detail.value) }); },
  stepQuantity(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.updateRule(rule.id, { quantity: Math.max(0, Math.min(rule.max, (Number(rule.quantity) || 0) + Number(event.currentTarget.dataset.step))) });
  },
  resetRules() { if (!this.data.busy) this.loadTemplate(this.data.newTemplateDraft ? this.data.activeTemplateId : this.data.templateId); },
  async saveTemplate() { await this.applyTemplate('saveDailyTemplate', false); },
  async saveAndUseTemplate() { await this.applyTemplate('saveDailyTemplate', true); },
  async activateTemplate() { await this.applyTemplate('activateDailyTemplate'); },
  async deleteTemplate() { await this.applyTemplate('deleteDailyTemplate'); },
  async applyTemplate(action, activate = false) {
    if (this.data.busy || this.data.isChild || !this.data.family) return;
    if (this.data.templateConflict) { wx.showToast({ title: '请重新载入家人更新后的模板', icon: 'none' }); return; }
    if (action !== 'saveDailyTemplate' && (this.data.newTemplateDraft || this.data.draftDirty)) { wx.showToast({ title: '请先保存或放弃当前修改', icon: 'none' }); return; }
    const rules: Array<Omit<AutoRule, 'quantity'> & { quantity: number | '' }> = this.data.rules.map((rule) => ({ kind: rule.id, mode: rule.mode, quantity: rule.quantity, scope: rule.scope, ...(rule.id === 'poetry' && rule.recitationPolicy !== 'all' ? { recitationPolicy: rule.recitationPolicy } : {}) }));
    if (!rules.every((rule): rule is AutoRule => typeof rule.quantity === 'number' && Number.isInteger(rule.quantity) && rule.quantity >= 0 && rule.quantity <= learning.definition(rule.kind).max)) {
      wx.showToast({ title: '请填写范围内的整数数量', icon: 'none' }); return;
    }
    const name = this.data.templateName.trim();
    if (action === 'saveDailyTemplate' && (!name || name.length > 24)) { wx.showToast({ title: '请填写24字以内的模板名称', icon: 'none' }); return; }
    const familyId = this.data.family.id; const childId = this.data.childId; const selected = this.data.templateId;
    const userId = this.engine.state.userId; const role = this.engine.state.family?.myRole;
    const values = { childId, templateId: selected, baseRevision: this.data.draftTemplateRevision,
      ...(action === 'saveDailyTemplate' ? { name, rules, activate } : {}) };
    const fingerprint = JSON.stringify([familyId, action, values]);
    if (this.templateMutation?.fingerprint !== fingerprint) this.templateMutation = { fingerprint, id: this.engine.makeId() };
    const payload = { ...values, mutationId: this.templateMutation.id };
    this.setData({ busy: true });
    try {
      const result = action === 'saveDailyTemplate'
        ? await this.engine.command(action, payload as Omit<ApiPayloads['saveDailyTemplate'], 'familyId'>)
        : await this.engine.command(action, payload);
      if (this.engine.state.userId === userId && this.engine.state.family?.myRole === role
        && this.data.family?.id === familyId && this.data.childId === childId && this.data.templateId === selected) {
        // Keep a confirmed template after a failed follow-up sync without replacing newer household fields.
        this.adoptTemplates(result.family, childId);
        this.setData({ draftDirty: false, newTemplateDraft: false, templateConflict: false });
        this.loadTemplate(action === 'deleteDailyTemplate' ? undefined : selected);
        if (activate || action === 'activateDailyTemplate' || selected === this.data.activeTemplateId) this.setData({ editor: 'preview' });
        wx.showToast({ title: action === 'deleteDailyTemplate' ? '模板已删除' : activate || action === 'activateDailyTemplate' ? '已启用，明日按此安排' : '模板已保存', icon: 'none' });
      }
    } catch (cause) {
      const error = errorDetails(cause);
      if (this.templateMutation) this.templateMutation.uncertain = !['CONFLICT', 'INVALID', 'FORBIDDEN', 'PARENT_REQUIRED', 'LIMIT', 'NOT_FOUND'].includes(error.code || '');
      if (error.code === 'CONFLICT' && this.data.family?.id === familyId && this.data.childId === childId) this.setData({ templateConflict: true, draftDirty: true });
      if (this.active) wx.showToast({ title: error.message || '模板保存失败，请重试', icon: 'none', duration: 3000 });
    } finally { this.setData({ busy: false }); this.render(); }
    await this.refresh();
  },
  async addPlan(event) {
    const form = event.detail.value; const kind = this.data.kinds[this.data.kindIndex];
    if (!form.title || !form.title.trim()) { wx.showToast({ title: '请填写学习内容名称', icon: 'none' }); return; }
    const result = await this.perform('addPlan', { childId: this.data.childId, title: form.title, detail: form.detail,
      minutes: Number(form.minutes || 5), kind: kind.id, subject: kind.subject, schedule: (['once', 'daily', 'library'] as const)[this.data.scheduleIndex],
      ...(this.data.scheduleIndex !== 2 ? { date: this.data.planDate } : {}), studyGrade: this.data.studyGrade || null });
    if (result) { this.setData({ formTitle: '', formDetail: '', formMinutes: '5' }); await this.refresh(); wx.showToast({ title: '已添加', icon: 'success' }); }
  },
  async togglePlan(event) { if (await this.perform('setPlanEnabled', { planId: event.currentTarget.dataset.id, enabled: event.detail.value })) await this.refresh(); }
};
Page(definition);
