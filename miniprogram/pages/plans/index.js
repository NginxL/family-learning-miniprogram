const { common } = require('../../lib/page');
const base = common();
Page({
  ...base,
  data: { ...base.data, subjects: ['古诗文', '英语', '其他'], subjectIndex: 0 },
  changeSubject(event) { this.setData({ subjectIndex: Number(event.detail.value) }); },
  async addPlan(event) {
    const form = event.detail.value;
    const result = await this.perform('addPlan', { childId: this.data.childId, title: form.title, detail: form.detail,
      minutes: Number(form.minutes), subject: ['poetry', 'english', 'other'][this.data.subjectIndex] });
    if (result) { this.setData({ formTitle: '', formDetail: '', formMinutes: '' }); wx.showToast({ title: '计划已添加', icon: 'success' }); }
  },
  async togglePlan(event) { await this.perform('setPlanEnabled', { planId: event.currentTarget.dataset.id, enabled: event.detail.value }); }
});
