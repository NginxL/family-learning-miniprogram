import { common } from '../../lib/page';
import { gradeLabels } from '../../lib/learning/learning';
import { errorDetails } from '../../lib/errors';
import type { ApiResults } from '../../../shared/api';
import type { SchoolGrade } from '../../../shared/models';
import type { LearningApp } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, PageDefinition } from '../../lib/page-types';
export interface ProgressData extends CommonData {
  progress: ApiResults['getProgress'] | null; progressBusy: boolean; progressError: string; progressCached: boolean; highestLabel?: string;
}
export interface ProgressMethods extends CommonMethods {
  afterRender(): void; afterSync(): Promise<void>; selectionChanged(): Promise<void>;
  browseGrade(event: DatasetEvent<{ grade: SchoolGrade }>): void; loadProgress(): Promise<void>;
}
interface ProgressRuntime extends CommonRuntime { progressKey?: string; progressRequest?: number }
const base = common();
const definition: PageDefinition<ProgressData, ProgressMethods, ProgressRuntime> = {
  ...base,
  data: { ...base.data, progress: null, progressBusy: false, progressError: '', progressCached: false },
  afterRender() {
    const key = `${this.data.family && this.data.family.id}:${this.data.childId}`;
    if (key !== this.progressKey) { this.progressKey = key; this.setData({ progress: null, progressError: '' }); }
  },
  afterSync() { return this.loadProgress(); },
  selectionChanged() { return this.loadProgress(); },
  browseGrade(event) {
    this.rememberSelection(); getApp<LearningApp>().navigation!.libraryGrade = Number(event.currentTarget.dataset.grade) as SchoolGrade;
    wx.switchTab({ url: '/pages/library/index' });
  },
  async loadProgress() {
    if (!this.data.family || !this.data.childId) return;
    const key = this.progressKey;
    const request = (this.progressRequest || 0) + 1; this.progressRequest = request;
    this.setData({ progressBusy: true, progressError: '' });
    try {
      const result = await this.engine.getProgress({ childId: this.data.childId });
      if (!this.active || key !== this.progressKey || this.progressRequest !== request) return;
      this.setData({ progress: result, progressCached: result.cached, highestLabel: gradeLabels[result.highestGradeStarted] });
    } catch (error) {
      if (this.active && key === this.progressKey && this.progressRequest === request) this.setData({ progressError: errorDetails(error).message || '知识进度加载失败' });
    } finally { if (this.progressRequest === request) this.setData({ progressBusy: false }); }
  },
  cleanup() { base.cleanup.call(this); this.progressRequest = (this.progressRequest || 0) + 1; }
};
Page(definition);
