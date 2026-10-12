const { common } = require('../../lib/page');
const learning = require('../../lib/learning/learning');
const base = common();
Page({
  ...base,
  data: { ...base.data, editor: 'auto', kinds: learning.kinds, kindIndex: 0, schedules: ['仅今天', '每天固定', '加入自动内容库'], scheduleIndex: 0,
    modes: ['全新', '复习'], rules: [], formTitle: '', formDetail: '', formMinutes: '5', draftDirty: false,
    studyGrade: 0, gradeLabels: learning.gradeLabels },
  afterRender() {
    if (!this.data.family) { this.draftChild = ''; return; }
    if (this.draftChild !== this.data.childId || !this.data.draftDirty) {
      this.draftChild = this.data.childId;
      this.setData({ rules: learning.ruleRows(this.data.family, this.data.childId), draftDirty: false });
    }
    this.updateVisibleRules();
    if (this.lastSubject !== this.data.subjectFilter) {
      this.lastSubject = this.data.subjectFilter;
      const index = learning.kinds.findIndex((kind) => kind.subject === this.data.subjectFilter);
      if (index >= 0) this.setData({ kindIndex: index });
    }
  },
  updateVisibleRules() {
    this.setData({ visibleRules: this.data.rules.filter((rule) => (this.data.subjectFilter === 'all' || rule.subject === this.data.subjectFilter)
      && (rule.id !== 'other' || rule.poolCount || rule.quantity)), dailyCount: this.data.rules.reduce((sum, rule) => sum + (Number(rule.quantity) || 0), 0) });
  },
  changeEditor(event) { this.setData({ editor: event.currentTarget.dataset.id }); },
  changeKind(event) { this.setData({ kindIndex: Number(event.detail.value) }); },
  changeSchedule(event) { this.setData({ scheduleIndex: Number(event.detail.value) }); },
  changeStudyGrade(event) { this.setData({ studyGrade: Number(event.detail.value) }); },
  updateRule(kind, patch) {
    this.setData({ rules: this.data.rules.map((rule) => {
      if (rule.id !== kind) return rule;
      const next = { ...rule, ...patch };
      next.scopeIndex = next.scopes.findIndex((scope) => scope.id === next.scope);
      next.poolCount = learning.materialPool(this.data.family, this.data.childId, next.scope).filter((item) => item.kind === kind).length;
      return next;
    }), draftDirty: true });
    this.updateVisibleRules();
  },
  changeMode(event) { this.updateRule(event.currentTarget.dataset.id, { mode: ['new', 'review'][Number(event.detail.value)] }); },
  changeScope(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id);
    this.updateRule(rule.id, { scope: rule.scopes[Number(event.detail.value)].id });
  },
  browseRule(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id);
    this.rememberSelection(); getApp().navigation.libraryKind = rule.id; getApp().navigation.libraryScope = rule.scope;
    wx.switchTab({ url: '/pages/library/index' });
  },
  changeQuantity(event) { this.updateRule(event.currentTarget.dataset.id, { quantity: event.detail.value === '' ? '' : Number(event.detail.value) }); },
  stepQuantity(event) {
    const rule = this.data.rules.find((item) => item.id === event.currentTarget.dataset.id);
    this.updateRule(rule.id, { quantity: Math.max(0, Math.min(rule.max, (Number(rule.quantity) || 0) + Number(event.currentTarget.dataset.step))) });
  },
  resetRules() { this.setData({ draftDirty: false }); this.render(); },
  async saveAutoPlans() {
    const rules = this.data.rules.map((rule) => ({ kind: rule.id, mode: rule.mode, quantity: rule.quantity, scope: rule.scope }));
    if (rules.some((rule) => !Number.isInteger(rule.quantity) || rule.quantity < 0 || rule.quantity > learning.definition(rule.kind).max)) {
      wx.showToast({ title: '请填写范围内的整数数量', icon: 'none' }); return;
    }
    const result = await this.perform('saveAutoPlans', { childId: this.data.childId, rules });
    if (result) { this.setData({ draftDirty: false }); this.render(); wx.showToast({ title: '每日安排已保存', icon: 'success' }); }
  },
  async addPlan(event) {
    const form = event.detail.value; const kind = this.data.kinds[this.data.kindIndex];
    if (!form.title || !form.title.trim()) { wx.showToast({ title: '请填写学习内容名称', icon: 'none' }); return; }
    const result = await this.perform('addPlan', { childId: this.data.childId, title: form.title, detail: form.detail,
      minutes: Number(form.minutes || 5), kind: kind.id, subject: kind.subject, schedule: ['once', 'daily', 'library'][this.data.scheduleIndex], studyGrade: this.data.studyGrade || null });
    if (result) { this.setData({ formTitle: '', formDetail: '', formMinutes: '5' }); wx.showToast({ title: '已添加', icon: 'success' }); }
  },
  async togglePlan(event) { await this.perform('setPlanEnabled', { planId: event.currentTarget.dataset.id, enabled: event.detail.value }); }
});
