const { common } = require('../../lib/page');
const { gradeLabels } = require('../../lib/learning/learning');
const base = common();
const ageValue = (value) => value === '' || value == null ? null : Number(value);
Page({
  ...base,
  data: { ...base.data, gradeLabels, createGrade: 0, addGrade: 0, editGrade: 0, editingChild: null },
  changeGrade(event) { this.setData({ [event.currentTarget.dataset.field]: Number(event.detail.value) }); },
  async createDemoFamily() {
    if (getApp().mode !== 'demo') return;
    await this.perform('createFamily', { name: '向阳学习小屋', memberName: '家长甲', childName: '小树', age: 6, schoolGrade: 1 });
  },
  async createFamily(event) {
    const result = await this.perform('createFamily', { ...event.detail.value, age: ageValue(event.detail.value.age), schoolGrade: this.data.createGrade || null });
    if (result) wx.showToast({ title: '家庭已创建', icon: 'success' });
  },
  async joinFamily(event) { const result = await this.perform('joinFamily', event.detail.value); if (result) wx.showToast({ title: '已加入家庭', icon: 'success' }); },
  async addChild(event) {
    const result = await this.perform('addChild', { ...event.detail.value, age: ageValue(event.detail.value.age), schoolGrade: this.data.addGrade || null });
    if (result) this.setData({ newChildName: '', newChildAge: '', addGrade: 0 });
  },
  editChild(event) {
    const child = this.data.children.find((item) => item.id === event.currentTarget.dataset.id);
    if (child) this.setData({ editingChild: { ...child, age: child.age == null ? '' : child.age }, editGrade: child.schoolGrade || 0 });
  },
  cancelEdit() { this.setData({ editingChild: null }); },
  async saveChild(event) {
    const child = this.data.editingChild;
    if (!child) return;
    const result = await this.perform('updateChild', { childId: child.id, baseVersion: child.version || 0,
      name: event.detail.value.name, age: ageValue(event.detail.value.age), schoolGrade: this.data.editGrade || null });
    if (result) { this.cancelEdit(); wx.showToast({ title: '档案已保存', icon: 'success' }); }
  },
  async createInvite() { const result = await this.perform('createInvite', {}); if (result) this.setData({ inviteCode: result.code }); },
  copyInvite() { if (this.data.inviteCode) wx.setClipboardData({ data: this.data.inviteCode }); },
  removeMember(event) {
    const { id, name } = event.currentTarget.dataset;
    wx.showModal({ title: `移除${name}？`, content: '对方将无法继续读取或更新这个家庭的数据。', confirmText: '移除',
      success: async (result) => { if (result.confirm) await this.perform('removeMember', { memberId: id }); } });
  },
  leaveFamily() {
    wx.showModal({ title: '退出这个家庭？', content: '本机待同步记录会清除，请先确认已经同步。家庭中的历史记录会保留。',
      success: async (result) => { if (result.confirm) await this.perform('leaveFamily', {}); } });
  }
});
