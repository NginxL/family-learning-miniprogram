import { decorate } from '../../lib/page';
import { groupTasks } from '../../lib/task-groups';
import { errorDetails } from '../../lib/errors';
import { parseTaskRoute, type TaskRouteQuery } from '../../lib/task-route';
import { pinyinFor, defaultPinyin, type PinyinText } from '../../lib/pinyin';
import { studyNotesView } from '../../lib/study-notes-view';
import { plannedTaskEdit, type PlannedTaskEditData, type PlannedTaskEditMethods } from '../../lib/planned-task-edit';
import { shiftDate } from '../../lib/sync-engine';
import type { HomeworkScope, Task } from '../../../shared/models';
import type { AppMode, LearningApp } from '../../lib/client-models';
import type { Decorated, PageDefinition, StudyNotesData, StudyNotesMethods } from '../../lib/page-types';
import type { SyncEngine } from '../../lib/sync-engine';

type Group = ReturnType<typeof groupTasks<Decorated<Task>>>[number];
type StudyRoute = HomeworkScope;
type Query = TaskRouteQuery;
const PAGE_SIZE = 20;

export interface StudyData extends StudyNotesData, PlannedTaskEditData {
  group: Omit<Group, 'items'> | null;
  items: Array<Decorated<Task> & { pinyin: PinyinText | null }>;
  showPinyin: boolean;
  hasPinyin: boolean;
  visibleCount: number;
  childName: string;
  date: string;
  mode: AppMode;
  busy: boolean;
  isChild: boolean;
  loading: boolean;
  pageError: string;
  emptyMessage: string;
  syncLabel: string;
  syncError: string;
  notice: string;
  planning: boolean;
}
export interface StudyMethods extends StudyNotesMethods, PlannedTaskEditMethods {
  onLoad(query: Query): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  cleanup(): void;
  onPullDownRefresh(): Promise<void>;
  render(): void;
  refresh(): Promise<void>;
  currentGroup(): Group | null;
  showMore(): void;
  togglePinyin(): void;
  toggleGroup(): Promise<void>;
  openToday(): void;
  openHomework(): void;
  dismissNotice(): void;
}
interface StudyRuntime {
  engine: SyncEngine;
  taskContext?: StudyRoute | null;
  submitting?: boolean;
  active?: boolean;
  unsubscribe?: () => boolean;
  timer?: ReturnType<typeof setInterval>;
  pinyinChoice?: boolean;
  planningEntry?: boolean;
  editing?: boolean;
}

const notes = studyNotesView();
const definition: PageDefinition<StudyData, StudyMethods, StudyRuntime> = {
  ...notes,
  ...plannedTaskEdit(),
  data: { ...notes.data, group: null, items: [], visibleCount: PAGE_SIZE, childName: '', date: '', mode: 'demo', busy: false, isChild: false,
    loading: true, pageError: '', emptyMessage: '', syncLabel: '', syncError: '', notice: '', showPinyin: false, hasPinyin: false,
    childId: '', today: '', maxPlanDate: '', editTarget: null, editDate: '', planning: false },
  onLoad(query) {
    this.engine = getApp<LearningApp>().engine;
    this.planningEntry = query.view === 'plan';
    // Only the explicit plan entry may read future tasks. Homework keeps its original past/today route validation.
    this.taskContext = parseTaskRoute(query, this.planningEntry ? shiftDate(this.engine.today, 365) : this.engine.today);
  },
  onShow() {
    this.cleanup();
    this.engine = getApp<LearningApp>().engine;
    this.active = true;
    this.setData({ busy: Boolean(this.submitting || this.editing) });
    this.unsubscribe = this.engine.subscribe(() => { if (this.active) this.render(); });
    this.render();
    if (this.taskContext) {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), 20000);
    }
  },
  onHide() { this.setData({ editTarget: null }); this.cleanup(); },
  onUnload() { this.cleanup(); },
  cleanup() {
    this.active = false;
    if (this.unsubscribe) this.unsubscribe();
    clearInterval(this.timer);
  },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  currentGroup() {
    const route = this.taskContext;
    const family = this.engine.snapshot().family;
    // A detail page stays on its original family, child and date, even after a refresh or midnight.
    if (!route || !family || family.id !== route.familyId || !family.children.some((child) => child.id === route.childId)) return null;
    const tasks = this.engine.viewDay(route.date).tasks.filter((task) => task.childId === route.childId).map(decorate);
    return groupTasks(tasks).find((group) => group.id === route.kind) || null;
  },
  render() {
    const route = this.taskContext;
    const snapshot = this.engine.snapshot();
    const family = snapshot.family;
    const child = family?.id === route?.familyId ? family?.children.find((item) => item.id === route?.childId) : undefined;
    let pageError = '';
    if (!route) pageError = '学习入口已失效，请返回今日重新选择。';
    else if (family && family.id !== route.familyId) pageError = '学习档案已切换，请返回今日重新选择。';
    else if (family && !child) pageError = '当前学习档案中找不到这位孩子，请返回今日重新选择。';
    const group = pageError ? null : this.currentGroup();
    const planning = Boolean(route && route.date > snapshot.today);
    const target = this.data.editTarget;
    if (target && (pageError || !planning || family?.myRole === 'child' || !child)) this.setData({ editTarget: null });
    const cached = route && family?.id === route.familyId && Boolean(snapshot.days[`${family.id}:${route.date}`]);
    let syncLabel = snapshot.status === 'syncing' ? '正在同步…' : snapshot.status === 'online' ? '已同步' : '等待连接';
    if (group?.pendingCount) syncLabel += ` · ${group.pendingCount} 项待同步`;
    let summary: StudyData['group'] = null;
    if (group) { const { items, ...info } = group; summary = info; }
    const items = (group?.items || []).slice(0, this.data.visibleCount).map((item) => ({ ...item, pinyin: pinyinFor(item) }));
    this.setData({ group: summary, items, hasPinyin: items.some((item) => item.pinyin), showPinyin: this.pinyinChoice ?? defaultPinyin(child?.schoolGrade),
      childId: child?.id || '', today: snapshot.today,
      maxPlanDate: shiftDate(snapshot.today, 365), planning,
      childName: child?.name || '', date: route?.date || '', mode: getApp<LearningApp>().mode,
      pageError, loading: !pageError && !cached && (snapshot.status === 'syncing' || snapshot.status === 'idle'),
      emptyMessage: !family ? '暂时连接不上学习档案，联网后重试。' : !cached ? '这一天的任务尚未加载，联网后重试。' : '这一天没有这类学习任务。',
      isChild: family?.myRole === 'child', syncLabel, syncError: snapshot.error, notice: snapshot.notice || '' });
  },
  async refresh() {
    if (!this.taskContext) return;
    const family = this.engine.snapshot().family;
    if (family && family.id !== this.taskContext.familyId) { if (this.active) this.render(); return; }
    await this.engine.sync(this.taskContext.date);
    if (this.active) this.render();
  },
  showMore() { this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE }); this.render(); },
  togglePinyin() { this.pinyinChoice = !this.data.showPinyin; this.setData({ showPinyin: this.pinyinChoice }); },
  async toggleGroup() {
    if (this.submitting || this.data.busy || !this.active || (this.taskContext && this.taskContext.date > this.engine.today)) return;
    const group = this.currentGroup();
    const route = this.taskContext;
    if (!group || !route) { this.render(); return; }
    this.submitting = true;
    this.setData({ busy: true });
    try {
      // Complete the entire group, including entries outside the currently visible batch.
      this.engine.enqueueMany(route.date, group.items.map((task) => task.id), !group.done);
      this.render();
      await this.engine.sync(route.date);
    } catch (error) {
      if (this.active) wx.showToast({ title: errorDetails(error).message || '操作失败', icon: 'none' });
    } finally {
      this.submitting = false;
      if (this.active) { this.setData({ busy: false }); this.render(); }
    }
  },
  openHomework() {
    if (!this.taskContext || this.taskContext.date > this.engine.today || !this.currentGroup()) return;
    const query = Object.entries(this.taskContext).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    wx.navigateTo({ url: `/pages/homework/index?${query}` });
  },
  openToday() { wx.switchTab({ url: this.planningEntry ? '/pages/plans/index' : '/pages/today/index' }); },
  dismissNotice() { this.engine.dismissNotice(); }
};
Page(definition);
