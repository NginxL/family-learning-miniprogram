import { common } from '../../lib/page';
import { groupTasks } from '../../lib/task-groups';
import { errorDetails } from '../../lib/errors';
import type { Task } from '../../../shared/models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, PageDefinition, ValueEvent } from '../../lib/page-types';
type Group = ReturnType<typeof groupTasks<Decorated<Task>>>[number];
export interface TodayData extends CommonData {
  groups: Array<Omit<Group, 'items'>>;
  groupCount: number; doneGroupCount: number; groupPercent: number;
}
export interface TodayMethods extends CommonMethods {
  afterRender(context: { allTasks: Decorated<Task>[] }): void;
  openGroup(event: DatasetEvent): void;
  toggleGroup(event: DatasetEvent): Promise<void>;
  changeDate(event: ValueEvent): Promise<void>;
  backToday(): Promise<void>;
}
interface TodayRuntime extends CommonRuntime { openingGroup?: boolean }
const base = common();
const definition: PageDefinition<TodayData, TodayMethods, TodayRuntime> = {
  ...base,
  data: { ...base.data, groups: [], groupCount: 0, doneGroupCount: 0, groupPercent: 0 },
  afterRender({ allTasks }) {
    // Old navigation may remember maths. Keep its records available under All.
    if (this.data.subjectFilter === 'math') {
      this.setData({ subjectFilter: 'all', tasks: allTasks, dayWarnings: (this.engine.viewDay(this.data.date).warnings || []).filter((warning) => warning.childId === this.data.childId) });
      this.rememberSelection();
    }
    const allGroups = groupTasks(allTasks);
    const groups = allGroups.filter((group) => this.data.subjectFilter === 'all' || group.subject === this.data.subjectFilter);
    const doneGroupCount = allGroups.filter((group) => group.done).length;
    this.setData({ groupCount: allGroups.length, doneGroupCount,
      groupPercent: allGroups.length ? Math.round(doneGroupCount / allGroups.length * 100) : 0,
      subjectOptions: this.data.subjectOptions.filter((subject) => subject.id !== 'math').map((subject) => ({ ...subject,
        count: allGroups.filter((group) => subject.id === 'all' || group.subject === subject.id).length })),
      groups: groups.map(({ items, ...group }) => group) });
  },
  openGroup(event) {
    const group = this.data.groups.find((item) => item.id === event.currentTarget.dataset.id);
    const family = this.engine.snapshot().family;
    if (this.openingGroup || !group || !family || family.id !== this.data.family?.id
      || !family.children.some((child) => child.id === this.data.childId)) return;
    this.rememberSelection();
    const query = Object.entries({ familyId: family.id, childId: this.data.childId, date: this.data.date, kind: group.id })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    this.openingGroup = true;
    wx.navigateTo({ url: `/pages/study/index?${query}`,
      fail: () => { wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }); },
      complete: () => { this.openingGroup = false; } });
  },
  async toggleGroup(event) {
    const date = this.data.date;
    const tasks = this.engine.viewDay(date).tasks.filter((task) => task.childId === this.data.childId);
    const group = groupTasks(tasks).find((item) => item.id === event.currentTarget.dataset.id);
    if (!group || (this.data.subjectFilter !== 'all' && group.subject !== this.data.subjectFilter)) return;
    try {
      this.engine.enqueueMany(date, group.items.map((task) => task.id), !group.done);
      this.render(); await this.engine.sync(date);
    }
    catch (error) { wx.showToast({ title: errorDetails(error).message || '操作失败', icon: 'none' }); }
  },
  async changeDate(event) { this.setData({ date: event.detail.value, followToday: event.detail.value === this.data.today }); this.render(); await this.engine.sync(this.data.date); },
  async backToday() { this.setData({ date: this.data.today, followToday: true }); this.render(); await this.engine.sync(this.data.date); }
};
Page(definition);
