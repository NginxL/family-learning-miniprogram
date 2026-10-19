import { common } from '../../lib/page';
import { catalog, gradeLabels } from '../../lib/learning/learning';
import { errorDetails } from '../../lib/errors';
import type { ApiResults } from '../../../shared/api';
import type { SchoolGrade } from '../../../shared/models';
import type { LearningApp } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, PageDefinition } from '../../lib/page-types';
export interface ProgressData extends CommonData {
  progress: ApiResults['getProgress'] | null; progressBusy: boolean; progressError: string; progressCached: boolean; highestLabel?: string;
  gradeSourceNotes: Record<number, string>;
}
export interface ProgressMethods extends CommonMethods {
  afterRender(): void; afterSync(): Promise<void>; selectionChanged(): Promise<void>;
  browseGrade(event: DatasetEvent<{ grade: SchoolGrade }>): void; loadProgress(): Promise<void>;
}
interface ProgressRuntime extends CommonRuntime { progressKey?: string; progressRequest?: number }
const base = common();
// Source disclosure is local so it also works with the unchanged 1.1.0 cloud response.
const gradeSourceNotes = Object.fromEntries(gradeLabels.slice(1).map((_, index) => {
  const grade = index + 1;
  const sampleOnly = catalog.filter(item => {
    const mappings = (item.gradeMappings || []).filter(mapping => mapping.grade === grade && mapping.schoolSystem === '5-4'
      && mapping.status === 'catalogue_verified' && mapping.mappingType !== 'aligned_practice');
    return mappings.length > 0 && mappings.every(mapping => mapping.sourceKind === 'public_sample');
  }).length;
  return [grade, sampleOnly ? `其中 ${sampleOnly} 项仅有第三方样本依据，官方原页待核实。` : ''];
}));
const definition: PageDefinition<ProgressData, ProgressMethods, ProgressRuntime> = {
  ...base,
  data: { ...base.data, progress: null, progressBusy: false, progressError: '', progressCached: false, gradeSourceNotes },
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
