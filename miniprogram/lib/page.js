const { chinaDate } = require('./sync-engine');
const subjects = { poetry: '古诗文', english: '英语', other: '其他' };
function common() {
  return {
    data: { family: null, children: [], childId: '', tasks: [], plans: [], members: [], date: chinaDate(), today: chinaDate(), mode: 'demo', busy: false },
    onShow() {
      this.engine = getApp().engine;
      this.unsubscribe = this.engine.subscribe(() => this.render());
      this.render();
      this.engine.sync(this.data.date);
      // Foreground-only polling; hide/unload releases it. No locked-screen guarantee.
      this.timer = setInterval(() => this.engine.sync(this.data.date), 20000);
    },
    onHide() { this.cleanup(); },
    onUnload() { this.cleanup(); },
    cleanup() { if (this.unsubscribe) this.unsubscribe(); clearInterval(this.timer); },
    async onPullDownRefresh() { try { await this.engine.sync(this.data.date); } finally { wx.stopPullDownRefresh(); } },
    render() {
      const snapshot = this.engine.snapshot();
      const family = snapshot.family;
      const children = family ? family.children : [];
      const childId = children.some((child) => child.id === this.data.childId) ? this.data.childId : (children[0] && children[0].id) || '';
      const tasks = this.engine.viewDay(this.data.date).tasks.filter((task) => task.childId === childId).map((task) => ({ ...task, subjectLabel: subjects[task.subject] }));
      const doneCount = tasks.filter((task) => task.done).length;
      const minutes = tasks.reduce((sum, task) => sum + task.minutes, 0);
      const plans = (family ? family.plans : []).filter((plan) => plan.childId === childId).map((plan) => ({ ...plan, subjectLabel: subjects[plan.subject] }));
      let syncLabel = snapshot.status === 'syncing' ? '正在同步…' : snapshot.status === 'online' ? '已同步' : '等待连接';
      if (snapshot.queue.length) syncLabel += ` · ${snapshot.queue.length} 条待同步`;
      const members = family ? family.members.map((member) => ({ ...member, isMe: member.id === snapshot.userId, roleLabel: member.role === 'owner' ? '创建者' : '家人' })) : [];
      this.setData({ family, children, childId, tasks, plans, members, today: snapshot.today,
        childIndex: Math.max(0, children.findIndex((child) => child.id === childId)),
        doneCount, minutes, percent: tasks.length ? Math.round(doneCount / tasks.length * 100) : 0,
        syncLabel, syncError: snapshot.error, notice: snapshot.notice, mode: getApp().mode });
    },
    selectChild(event) { this.setData({ childId: event.currentTarget.dataset.id }); this.render(); },
    pickChild(event) { const child = this.data.children[Number(event.detail.value)]; if (child) { this.setData({ childId: child.id }); this.render(); } },
    async refresh() { await this.engine.sync(this.data.date); },
    dismissNotice() { this.engine.dismissNotice(); },
    openFamily() { wx.switchTab({ url: '/pages/family/index' }); },
    openPlans() { wx.switchTab({ url: '/pages/plans/index' }); },
    async perform(action, payload) {
      if (this.data.busy) return null;
      this.setData({ busy: true });
      try { return await this.engine.command(action, payload); }
      catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 3000 }); return null; }
      finally { this.setData({ busy: false }); this.render(); }
    }
  };
}
module.exports = { common };
