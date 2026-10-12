const { chinaDate } = require('./sync-engine');
const learning = require('./learning/learning');
const modeLabels = { new: '全新', review: '复习', manual: '家长安排' };
const decorate = (item) => ({ ...item, kindLabel: learning.definition(learning.kindOf(item)).label,
  subjectLabel: (learning.subjects.find((subject) => subject.id === item.subject) || {}).label || '其他',
  modeLabel: modeLabels[item.mode] || '家长安排' });
function common() {
  return {
    data: { family: null, children: [], childId: '', tasks: [], plans: [], members: [], date: chinaDate(), today: chinaDate(),
      followToday: true, subjectFilter: 'all', subjectOptions: learning.subjects, mode: 'demo', busy: false },
    onShow() {
      this.engine = getApp().engine;
      const navigation = getApp().navigation || {};
      this.setData({ childId: navigation.childId || this.data.childId, subjectFilter: navigation.subject || this.data.subjectFilter });
      if (navigation.date) { this.setData({ date: navigation.date, followToday: true }); delete navigation.date; }
      this.active = true;
      this.unsubscribe = this.engine.subscribe(() => this.render());
      this.render(); this.refresh();
      this.timer = setInterval(() => this.refresh(), 20000);
    },
    onHide() { this.cleanup(); },
    onUnload() { this.cleanup(); },
    cleanup() { this.active = false; if (this.unsubscribe) this.unsubscribe(); clearInterval(this.timer); },
    async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
    render() {
      const snapshot = this.engine.snapshot();
      const family = snapshot.family;
      const children = family ? family.children.map((child) => ({ ...child, gradeLabel: learning.gradeLabels[child.schoolGrade || 0] })) : [];
      const childId = children.some((child) => child.id === this.data.childId) ? this.data.childId : (children[0] && children[0].id) || '';
      const date = this.data.followToday ? snapshot.today : this.data.date;
      const day = this.engine.viewDay(date);
      const allTasks = day.tasks.filter((task) => task.childId === childId).map(decorate);
      const tasks = allTasks.filter((task) => this.data.subjectFilter === 'all' || task.subject === this.data.subjectFilter);
      const doneCount = allTasks.filter((task) => task.done).length;
      const minutes = allTasks.reduce((sum, task) => sum + task.minutes, 0);
      const plans = (family ? family.plans : []).filter((plan) => plan.childId === childId)
        .filter((plan) => this.data.subjectFilter === 'all' || plan.subject === this.data.subjectFilter)
        .map((plan) => ({ ...decorate(plan), scheduleLabel: plan.schedule === 'library' ? '自动内容库' : plan.schedule === 'once' ? `仅 ${plan.date}` : '每天固定' }));
      let syncLabel = snapshot.status === 'syncing' ? '正在同步…' : snapshot.status === 'online' ? '已同步' : '等待连接';
      if (snapshot.queue.length) syncLabel += ` · ${snapshot.queue.length} 条待同步`;
      const members = family ? family.members.map((member) => ({ ...member, isMe: member.id === snapshot.userId, roleLabel: member.role === 'owner' ? '创建者' : '家人' })) : [];
      const subjectOptions = learning.subjects.map((subject) => ({ ...subject,
        count: subject.id === 'all' ? allTasks.length : allTasks.filter((task) => task.subject === subject.id).length }));
      this.setData({ family, children, childId, date, tasks, allTaskCount: allTasks.length, plans, members, today: snapshot.today, subjectOptions,
        dayWarnings: (day.warnings || []).filter((warning) => warning.childId === childId && (this.data.subjectFilter === 'all' || learning.definition(warning.kind).subject === this.data.subjectFilter)),
        childIndex: Math.max(0, children.findIndex((child) => child.id === childId)),
        doneCount, minutes, percent: allTasks.length ? Math.round(doneCount / allTasks.length * 100) : 0,
        syncLabel, syncError: snapshot.error, notice: snapshot.notice, mode: getApp().mode });
      if (this.afterRender) this.afterRender({ allTasks });
    },
    rememberSelection() { getApp().navigation = { childId: this.data.childId, subject: this.data.subjectFilter }; },
    selectChild(event) {
      this.setData({ childId: event.currentTarget.dataset.id }); this.rememberSelection(); this.render();
      if (this.selectionChanged) this.selectionChanged();
    },
    selectSubject(event) {
      this.setData({ subjectFilter: event.currentTarget.dataset.id }); this.rememberSelection(); this.render();
      if (this.selectionChanged) this.selectionChanged();
    },
    async refresh() {
      const requested = this.data.date;
      await this.engine.sync(requested);
      if (this.data.followToday && requested !== this.data.date) await this.engine.sync(this.data.date);
      if (this.active && this.afterSync) await this.afterSync();
    },
    dismissNotice() { this.engine.dismissNotice(); },
    openFamily() { wx.switchTab({ url: '/pages/family/index' }); },
    openPlans() { this.rememberSelection(); wx.switchTab({ url: '/pages/plans/index' }); },
    openHistory() { this.rememberSelection(); wx.switchTab({ url: '/pages/history/index' }); },
    openLibrary() { this.rememberSelection(); wx.switchTab({ url: '/pages/library/index' }); },
    openExamScope() { this.rememberSelection(); getApp().navigation.libraryView = 'exam'; wx.switchTab({ url: '/pages/library/index' }); },
    openProgress(event) {
      const id = event && event.currentTarget && event.currentTarget.dataset.id;
      if (id) this.setData({ childId: id });
      this.rememberSelection(); wx.navigateTo({ url: '/pages/progress/index' });
    },
    openToday() {
      this.rememberSelection(); getApp().navigation.date = this.data.today;
      wx.switchTab({ url: '/pages/today/index' });
    },
    async perform(action, payload) {
      if (this.data.busy) return null;
      this.setData({ busy: true });
      try { return await this.engine.command(action, payload); }
      catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none', duration: 3000 }); return null; }
      finally { this.setData({ busy: false }); this.render(); }
    }
  };
}
module.exports = { common, decorate };
