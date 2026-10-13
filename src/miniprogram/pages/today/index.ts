import { common } from '../../lib/page';
import { groupTasks } from '../../lib/task-groups';
import { errorDetails } from '../../lib/errors';
import type { Task } from '../../../shared/models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, PageDefinition, ValueEvent } from '../../lib/page-types';
type Group = ReturnType<typeof groupTasks<Decorated<Task>>>[number];
export interface TodayData extends CommonData {
  groups: Array<Group & { expanded: boolean }>;
  expandedGroupId: string; expandedId: string; groupCount: number; doneGroupCount: number; groupPercent: number;
}
export interface TodayMethods extends CommonMethods {
  afterRender(context: { allTasks: Decorated<Task>[] }): void;
  expandGroup(event: DatasetEvent): void;
  toggleGroup(event: DatasetEvent): Promise<void>;
  expandTask(event: DatasetEvent): void;
  changeDate(event: ValueEvent): Promise<void>;
  backToday(): Promise<void>;
}
interface TodayRuntime extends CommonRuntime { groupContext?: string }
const base = common();
const definition: PageDefinition<TodayData, TodayMethods, TodayRuntime> = {
  ...base,
  data: { ...base.data, groups: [], expandedGroupId: '', expandedId: '', groupCount: 0, doneGroupCount: 0, groupPercent: 0 },
  afterRender({ allTasks }) {
    const context = JSON.stringify([this.data.family && this.data.family.id, this.data.childId, this.data.date, this.data.subjectFilter]);
    const allGroups = groupTasks(allTasks);
    const groups = allGroups.filter((group) => this.data.subjectFilter === 'all' || group.subject === this.data.subjectFilter);
    const expandedGroupId = this.groupContext === context && groups.some((group) => group.id === this.data.expandedGroupId) ? this.data.expandedGroupId : '';
    const openGroup = groups.find((group) => group.id === expandedGroupId);
    const expandedId = openGroup && openGroup.items.some((task) => task.id === this.data.expandedId) ? this.data.expandedId : '';
    this.groupContext = context;
    const doneGroupCount = allGroups.filter((group) => group.done).length;
    this.setData({ expandedGroupId, expandedId, groupCount: allGroups.length, doneGroupCount,
      groupPercent: allGroups.length ? Math.round(doneGroupCount / allGroups.length * 100) : 0,
      subjectOptions: this.data.subjectOptions.map((subject) => ({ ...subject,
        count: allGroups.filter((group) => subject.id === 'all' || group.subject === subject.id).length })),
      groups: groups.map((group) => ({ ...group, expanded: group.id === expandedGroupId,
        items: group.id === expandedGroupId ? group.items : [] })) });
  },
  expandGroup(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedGroupId: this.data.expandedGroupId === id ? '' : id, expandedId: '' }); this.render();
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
  expandTask(event) { const id = event.currentTarget.dataset.id; this.setData({ expandedId: this.data.expandedId === id ? '' : id }); },
  async changeDate(event) { this.setData({ date: event.detail.value, followToday: event.detail.value === this.data.today, expandedId: '' }); this.render(); await this.engine.sync(this.data.date); },
  async backToday() { this.setData({ date: this.data.today, followToday: true }); this.render(); await this.engine.sync(this.data.date); }
};
Page(definition);
