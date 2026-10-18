import { shiftDate } from './sync-engine';
import { errorDetails } from './errors';
import * as learning from './learning/learning';
import type { PageDefinition, DatasetEvent, ValueEvent } from './page-types';
import type { SyncEngine } from './sync-engine';

type Target = { id: string; title: string; familyId: string; childId: string; childName: string; userId: string | null };
export interface ContentScheduleData {
  assignTarget: Target | null; assignDate: string; today: string; tomorrow: string; maxPlanDate: string;
  childId: string; busy: boolean;
}
export interface ContentScheduleMethods {
  openAssignment(contentId: string, preferredDate?: string): void; refreshAssignment(): void;
  closeAssign(): void; keepSheet(): void; chooseAssignDate(event: DatasetEvent<{ date: string }>): void;
  changeAssignDate(event: ValueEvent): void; confirmAssign(): Promise<void>;
}
interface Runtime { engine: SyncEngine; active?: boolean; assigning?: boolean; render(): void }
export function contentSchedule(): PageDefinition<ContentScheduleData, ContentScheduleMethods, Runtime> {
  return {
    data: { assignTarget: null, assignDate: '', today: '', tomorrow: '', maxPlanDate: '', childId: '', busy: false },
    refreshAssignment() {
      const { today, family, userId } = this.engine.snapshot(); const target = this.data.assignTarget;
      this.setData({ today, tomorrow: shiftDate(today, 1), maxPlanDate: shiftDate(today, 365),
        ...(target && (target.familyId !== family?.id || target.userId !== userId || target.childId !== this.data.childId
          || family?.myRole === 'child' || !family?.children.some(child => child.id === target.childId)) ? { assignTarget: null } : {}) });
    },
    openAssignment(contentId, preferredDate) {
      if (this.active === false || this.data.busy || this.assigning) return;
      this.refreshAssignment();
      const { family, userId, today } = this.engine.snapshot();
      const child = family?.children.find(child => child.id === this.data.childId);
      const item = learning.catalogById.get(contentId);
      if (!family || family.myRole === 'child' || !child || !item) return;
      this.setData({ assignTarget: { id: item.id, title: item.title, familyId: family.id, childId: child.id, childName: child.name, userId },
        assignDate: preferredDate && preferredDate >= today && preferredDate <= this.data.maxPlanDate ? preferredDate : today });
    },
    closeAssign() { if (!this.data.busy) this.setData({ assignTarget: null }); },
    keepSheet() {},
    chooseAssignDate(event) { if (!this.data.busy) this.setData({ assignDate: event.currentTarget.dataset.date }); },
    changeAssignDate(event) { if (!this.data.busy) this.setData({ assignDate: event.detail.value }); },
    async confirmAssign() {
      if (this.active === false || this.data.busy || this.assigning) return;
      this.refreshAssignment();
      const target = this.data.assignTarget, date = this.data.assignDate;
      if (!target) return;
      const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || date < this.data.today || date > this.data.maxPlanDate) {
        wx.showToast({ title: '请选择今日起一年内的有效日期', icon: 'none' }); return;
      }
      this.assigning = true; this.setData({ busy: true });
      try {
        await this.engine.command('assignContent', { childId: target.childId, contentId: target.id, date });
        this.refreshAssignment();
        if (this.active && this.data.assignTarget === target) {
          this.setData({ assignTarget: null });
          wx.showToast({ title: `已加入${date === this.data.today ? '今日' : date === this.data.tomorrow ? '明日' : date}`, icon: 'none' });
        }
      } catch (error) {
        if (this.active && this.data.assignTarget === target) wx.showToast({ title: errorDetails(error).message || '安排失败，请重试', icon: 'none', duration: 3000 });
      } finally {
        this.assigning = false; this.setData({ busy: false }); if (this.active) this.render();
      }
    }
  };
}
