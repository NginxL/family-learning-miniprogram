import { common } from '../../lib/page';
import { groupTasks } from '../../lib/task-groups';
import { shiftDate } from '../../lib/sync-engine';
import { errorDetails } from '../../lib/errors';
import * as learning from '../../lib/learning/learning';
import type { AutoRule, ContentKind, SchoolGrade, SubjectFilter, Task, DailyTemplate } from '../../../shared/models';
import type { ApiPayloads } from '../../../shared/api';
import type { LearningApp } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, FieldEvent, PageDefinition, PickerEvent, ValueEvent } from '../../lib/page-types';
export type RuleDraft = Omit<ReturnType<typeof learning.ruleRows>[number], 'quantity'> & { quantity: number | '' };
interface EditTarget { familyId: string; childId: string; date: string; taskId: string; contentId: string; title: string; baseVersion: number; planRevision: number }
export interface PlansData extends CommonData {
  editor: 'preview' | 'auto' | 'manual'; kinds: typeof learning.kinds; kindIndex: number;
  schedules: string[]; scheduleIndex: number; modes: string[]; rules: RuleDraft[];
  formTitle: string; formDetail: string; formMinutes: string; draftDirty: boolean;
  studyGrade: SchoolGrade | 0; gradeLabels: string[]; visibleRules?: RuleDraft[]; dailyCount?: number;
  groups: ReturnType<typeof groupTasks<Decorated<Task>>>; expandedKind: ContentKind | ''; previewLimit: number;
  planDate: string; maxPlanDate: string; previewReady: boolean;
  editTarget: EditTarget | null; editDate: string;
  templates: Array<DailyTemplate & { label: string }>; templateId: string; templateName: string; templateIndex: number;
  activeTemplateId: string; activeTemplateName: string; activeTemplateSummary: string;
  templateRevision: number; draftTemplateRevision: number; templateConflict: boolean; newTemplateDraft: boolean;
}
export interface PlansMethods extends CommonMethods {
  afterRender(): void; updateVisibleRules(): void;
  changeEditor(event: DatasetEvent<{ id: PlansData['editor'] }>): void;
  changeKind(event: PickerEvent): void; changeSchedule(event: PickerEvent): void; changeStudyGrade(event: PickerEvent): void;
  changePlanDate(event: ValueEvent): void; togglePreview(event: DatasetEvent<{ id: ContentKind }>): void; showMorePreview(): void;
  updateRule(kind: ContentKind, patch: Partial<Pick<RuleDraft, 'mode' | 'scope' | 'quantity'>>): void;
  changeMode(event: FieldEvent<string | number, { id: ContentKind }>): void;
  changeScope(event: FieldEvent<string | number, { id: ContentKind }>): void;
  browseRule(event: DatasetEvent<{ id: ContentKind }>): void;
  changeQuantity(event: FieldEvent<string, { id: ContentKind }>): void;
  stepQuantity(event: DatasetEvent<{ id: ContentKind; step: string | number }>): void;
  resetRules(): void; loadTemplate(id?: string): void; openTemplate(): void;
  selectTemplate(event: PickerEvent): void; createTemplate(): void; changeTemplateName(event: ValueEvent): void;
  saveTemplate(): Promise<void>; saveAndUseTemplate(): Promise<void>; activateTemplate(): Promise<void>; deleteTemplate(): Promise<void>;
  applyTemplate(action: 'saveDailyTemplate' | 'activateDailyTemplate' | 'deleteDailyTemplate', activate?: boolean): Promise<void>;
  addPlan(event: ValueEvent<{ title: string; detail: string; minutes: string }>): Promise<void>;
  togglePlan(event: FieldEvent<boolean, { id: string }>): Promise<void>;
  editTask(event: DatasetEvent): void; closeEdit(): void; changeEditDate(event: ValueEvent): void;
  saveTaskDate(): Promise<void>; deleteTask(): Promise<void>; applyTaskEdit(remove: boolean): Promise<void>;
}
interface PlansRuntime extends CommonRuntime { draftScope?: string; templateMutation?: { fingerprint: string; id: string; uncertain?: boolean }; lastSubject?: SubjectFilter; previewKey?: string; defaultPlanDate?: string; editMutation?: { fingerprint: string; id: string } }
const base = common();
const definition: PageDefinition<PlansData, PlansMethods, PlansRuntime> = {
  ...base,
  data: { ...base.data, followToday: false, followTomorrow: true, editor: 'preview', kinds: learning.kinds, kindIndex: 0, schedules: ['仅指定日期', '从指定日期起每天固定', '加入自动内容库'], scheduleIndex: 0,
    modes: ['全新', '复习'], rules: [], formTitle: '', formDetail: '', formMinutes: '5', draftDirty: false,
    studyGrade: 0, gradeLabels: learning.gradeLabels, groups: [], expandedKind: '', previewLimit: 20,
    planDate: '', maxPlanDate: '', previewReady: false, editTarget: null, editDate: '',
    templates: [], templateId: '', templateName: '', templateIndex: 0, activeTemplateId: '', activeTemplateName: '', activeTemplateSummary: '',
    templateRevision: 0, draftTemplateRevision: 0, templateConflict: false, newTemplateDraft: false },
  onHide() { this.setData({ editTarget: null }); base.onHide.call(this); },
  afterRender() {
    const target = this.data.editTarget;
    if (target && (this.data.isChild || this.data.family?.id !== target.familyId || this.data.childId !== target.childId || this.data.date !== target.date)) this.setData({ editTarget: null });
    const key = `${this.data.family?.id}:${this.data.childId}:${this.data.date}:${this.data.subjectFilter}`;
    if (key !== this.previewKey) { this.previewKey = key; this.setData({ expandedKind: '', previewLimit: 20 }); }
    if (this.defaultPlanDate !== this.data.date) {
      this.defaultPlanDate = this.data.date; this.setData({ planDate: this.data.date, maxPlanDate: shiftDate(this.data.today, 365) });
    }
    this.setData({ groups: groupTasks(this.data.tasks).map((group) => ({ ...group,
      items: group.id === this.data.expandedKind ? group.items.slice(0, this.data.previewLimit) : [] })),
      previewReady: Boolean(this.data.family && this.engine.state.days[`${this.data.family.id}:${this.data.date}`]) });
    if (!this.data.family) { this.draftScope = ''; this.setData({ rules: [], templates: [], templateName: '', draftDirty: false }); return; }
    const set = learning.templateSet(this.data.family, this.data.childId);
    const active = set.templates.find((item) => item.id === set.activeId)!;
    this.setData({ templates: set.templates.map((item) => ({ ...item, label: item.name + (item.id === set.activeId ? ' · 使用中' : '') })),
      activeTemplateId: active.id, activeTemplateName: active.name, activeTemplateSummary: learning.templateSummary(active.rules), templateRevision: set.revision });
    const scope = `${this.data.family.id}:${this.data.childId}`;
    if (this.draftScope !== scope) { this.draftScope = scope; this.loadTemplate(active.id); }
    else if (!this.data.draftDirty && !this.data.busy && !this.templateMutation?.uncertain) this.loadTemplate(this.data.templateId);
    else this.setData({ templateConflict: set.revision !== this.data.draftTemplateRevision && !this.templateMutation?.uncertain });
    this.updateVisibleRules();
    if (this.lastSubject !== this.data.subjectFilter) {
      this.lastSubject = this.data.subjectFilter;
      const index = learning.kinds.findIndex((kind) => kind.subject === this.data.subjectFilter);
      if (index >= 0) this.setData({ kindIndex: index });
    }
  },
  updateVisibleRules() {
    this.setData({ visibleRules: this.data.rules.filter((rule) => !['math', 'other'].includes(rule.id) || Number(rule.quantity) > 0), dailyCount: this.data.rules.reduce((sum, rule) => sum + (Number(rule.quantity) || 0), 0) });
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
  openTemplate() { if (!this.data.draftDirty) this.loadTemplate(this.data.activeTemplateId); this.setData({ editor: 'auto' }); },
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
  editTask(event) {
    if (this.data.busy || this.data.isChild || !this.data.family || this.data.date <= this.data.today) return;
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task || task.done) return;
    const day = this.engine.viewDay(this.data.date);
    this.editMutation = undefined;
    this.setData({ editTarget: { familyId: this.data.family.id, childId: task.childId, date: this.data.date, taskId: task.id, contentId: task.contentId,
      title: task.title, baseVersion: task.version, planRevision: day.planRevision || 0 }, editDate: this.data.date });
  },
  closeEdit() { if (!this.data.busy) this.setData({ editTarget: null }); },
  changeEditDate(event) { if (!this.data.busy) this.setData({ editDate: event.detail.value }); },
  async saveTaskDate() { await this.applyTaskEdit(false); },
  async deleteTask() { await this.applyTaskEdit(true); },
  async applyTaskEdit(remove) {
    const target = this.data.editTarget;
    if (!target || this.data.busy || this.data.isChild || this.data.family?.id !== target.familyId || this.data.childId !== target.childId || this.data.date !== target.date) return;
    if (!remove && this.data.editDate === target.date) { wx.showToast({ title: '请选择不同的学习日期', icon: 'none' }); return; }
    const { title: _title, familyId: _familyId, childId: _childId, ...source } = target;
    const payload = { ...source, ...(remove ? {} : { targetDate: this.data.editDate }) };
    const fingerprint = JSON.stringify(payload);
    if (this.editMutation?.fingerprint !== fingerprint) this.editMutation = { fingerprint, id: this.engine.makeId() };
    this.setData({ busy: true });
    try {
      const result = await this.engine.command('editPlannedTask', { ...payload, mutationId: this.editMutation.id });
      if (this.data.editTarget === target) {
        this.setData({ editTarget: null });
        wx.showToast({ title: remove ? '已删除这次安排' : result.merged ? '已合并到目标日期' : `已改到${result.targetDate}`, icon: 'none' });
      }
    } catch (cause) {
      const error = errorDetails(cause);
      if (error.code === 'CONFLICT' && this.data.editTarget === target) this.setData({ editTarget: null });
      if (this.active) wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 3000 });
    } finally { this.setData({ busy: false }); this.render(); }
    await this.refresh();
  },
  togglePreview(event) {
    this.setData({ expandedKind: this.data.expandedKind === event.currentTarget.dataset.id ? '' : event.currentTarget.dataset.id, previewLimit: 20 }); this.render();
  },
  showMorePreview() { this.setData({ previewLimit: this.data.previewLimit + 20 }); this.render(); },
  changeKind(event) { this.setData({ kindIndex: Number(event.detail.value) }); },
  changeSchedule(event) { this.setData({ scheduleIndex: Number(event.detail.value) }); },
  changeStudyGrade(event) { this.setData({ studyGrade: Number(event.detail.value) as SchoolGrade | 0 }); },
  updateRule(kind, patch) {
    if (this.data.busy || this.data.isChild) return;
    this.setData({ rules: this.data.rules.map((rule) => {
      if (rule.id !== kind) return rule;
      const next = { ...rule, ...patch };
      next.scopeIndex = next.scopes.findIndex((scope) => scope.id === next.scope);
      next.poolCount = learning.materialPool(this.data.family!, this.data.childId, next.scope).filter((item) => item.kind === kind).length;
      return next;
    }), draftDirty: true });
    this.updateVisibleRules();
  },
  changeMode(event) { this.updateRule(event.currentTarget.dataset.id, { mode: (['new', 'review'] as const)[Number(event.detail.value)] }); },
  changeScope(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.updateRule(rule.id, { scope: rule.scopes[Number(event.detail.value)].id });
  },
  browseRule(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.rememberSelection(); getApp<LearningApp>().navigation!.libraryKind = rule.id; getApp<LearningApp>().navigation!.libraryScope = rule.scope;
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
    const rules = this.data.rules.map((rule) => ({ kind: rule.id, mode: rule.mode, quantity: rule.quantity, scope: rule.scope }));
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
        const family = this.engine.state.family;
        const confirmed = learning.templateSet(result.family, childId);
        if (family?.id === familyId && learning.templateSet(family, childId).revision < confirmed.revision)
          this.engine.save({ ...this.engine.state, family: { ...family,
            templateSets: { ...family.templateSets, [childId]: confirmed },
            autoPlans: { ...family.autoPlans, [childId]: confirmed.templates.find((item) => item.id === confirmed.activeId)!.rules } } });
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
