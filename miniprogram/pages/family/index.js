const { common } = require('../../lib/page');
Page({
  ...common(),
  async createDemoFamily() {
    if (getApp().mode !== 'demo') return;
    await this.perform('createFamily', { name: '向阳学习小屋', memberName: '家长甲', childName: '小树' });
  },
  async createFamily(event) { const result = await this.perform('createFamily', event.detail.value); if (result) wx.showToast({ title: '家庭已创建', icon: 'success' }); },
  async joinFamily(event) { const result = await this.perform('joinFamily', event.detail.value); if (result) wx.showToast({ title: '已加入家庭', icon: 'success' }); },
  async addChild(event) { const result = await this.perform('addChild', event.detail.value); if (result) this.setData({ newChildName: '' }); },
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
