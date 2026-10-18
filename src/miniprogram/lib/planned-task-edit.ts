import { errorDetails } from './errors';
import type { DatasetEvent, PageInstance, ValueEvent } from './page-types';
import type { SyncEngine } from './sync-engine';

interface EditTarget { familyId: string; childId: string; date: string; taskId: string; contentId: string; title: string; baseVersion: number; planRevision: number }
export interface PlannedTaskEditData {
  childId: string; today: string; date: string;
  busy: boolean; isChild: boolean; maxPlanDate: string; editTarget: EditTarget | null; editDate: string;
}
export interface PlannedTaskEditMethods {
  editTask(event: DatasetEvent): void; closeEdit(): void; changeEditDate(event: ValueEvent): void;
  saveTaskDate(): Promise<void>; deleteTask(): Promise<void>; applyTaskEdit(remove: boolean): Promise<void>;
}
export interface PlannedTaskEditRuntime {
  engine: SyncEngine; active?: boolean; editing?: boolean; editMutation?: { fingerprint: string; id: string };
  render(): void; refresh(): Promise<void>;
}
export function plannedTaskEdit(): PlannedTaskEditMethods & ThisType<PageInstance<PlannedTaskEditData, PlannedTaskEditMethods, PlannedTaskEditRuntime>> {
  return {
    editTask(event) {
      const family = this.engine.snapshot().family;
      if (this.data.busy || this.data.isChild || family?.myRole === 'child' || !family
        || !family.children.some(child => child.id === this.data.childId) || this.data.date <= this.engine.today) return;
      const day = this.engine.viewDay(this.data.date);
      const task = day.tasks.find((item) => item.id === event.currentTarget.dataset.id && item.childId === this.data.childId);
      if (!task || task.done) return;
      this.editMutation = undefined;
      this.setData({ editTarget: { familyId: family.id, childId: task.childId, date: this.data.date, taskId: task.id, contentId: task.contentId,
        title: task.title, baseVersion: task.version, planRevision: day.planRevision || 0 }, editDate: this.data.date });
    },
    closeEdit() { if (!this.data.busy) this.setData({ editTarget: null }); },
    changeEditDate(event) { if (!this.data.busy) this.setData({ editDate: event.detail.value }); },
    async saveTaskDate() { await this.applyTaskEdit(false); },
    async deleteTask() { await this.applyTaskEdit(true); },
    async applyTaskEdit(remove) {
      const target = this.data.editTarget;
      const family = this.engine.snapshot().family;
      if (!target || this.data.busy || this.editing || family?.myRole === 'child' || family?.id !== target.familyId
        || this.data.childId !== target.childId || this.data.date !== target.date || target.date <= this.engine.today) return;
      if (!remove && this.data.editDate === target.date) { wx.showToast({ title: '请选择不同的学习日期', icon: 'none' }); return; }
      const { title: _title, familyId: _familyId, childId: _childId, ...source } = target;
      const payload = { ...source, ...(remove ? {} : { targetDate: this.data.editDate }) };
      const fingerprint = JSON.stringify(payload);
      if (this.editMutation?.fingerprint !== fingerprint) this.editMutation = { fingerprint, id: this.engine.makeId() };
      this.editing = true;
      this.setData({ busy: true });
      try {
        const result = await this.engine.command('editPlannedTask', { ...payload, mutationId: this.editMutation.id });
        if (this.active && this.data.editTarget === target) {
          this.setData({ editTarget: null });
          wx.showToast({ title: remove ? '已删除这次安排' : result.merged ? '已合并到目标日期' : `已改到${result.targetDate}`, icon: 'none' });
        }
      } catch (cause) {
        const error = errorDetails(cause);
        if (this.active && error.code === 'CONFLICT' && this.data.editTarget === target) this.setData({ editTarget: null });
        if (this.active) wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 3000 });
      } finally { this.editing = false; if (this.active) { this.setData({ busy: false }); this.render(); } }
      await this.refresh();
    }
  };
}
