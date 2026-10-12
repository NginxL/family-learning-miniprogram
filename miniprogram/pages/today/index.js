const { common } = require('../../lib/page');
Page({
  ...common(),
  toggleTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    try { this.engine.enqueue(this.data.date, task.id, !task.done); this.engine.sync(this.data.date); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  expandTask(event) { const id = event.currentTarget.dataset.id; this.setData({ expandedId: this.data.expandedId === id ? '' : id }); },
  async changeDate(event) { this.setData({ date: event.detail.value, followToday: event.detail.value === this.data.today, expandedId: '' }); this.render(); await this.engine.sync(this.data.date); },
  async backToday() { this.setData({ date: this.data.today, followToday: true }); this.render(); await this.engine.sync(this.data.date); }
});
