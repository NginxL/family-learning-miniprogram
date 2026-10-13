import { common, decorate } from '../../lib/page';
import { errorDetails } from '../../lib/errors';
import type { ApiResults } from '../../../shared/api';
import type { HistoryQuery } from '../../../shared/models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, PageDefinition, ValueEvent } from '../../lib/page-types';
export interface HistoryData extends CommonData {
  historyItems: Array<Decorated<ApiResults['getHistory']['items'][number]>>;
  historyFilter: NonNullable<HistoryQuery['filter']>; query: string; historyBusy: boolean; historyError: string;
  historyCached: boolean; historyTotal: number; stats: ApiResults['getHistory']['stats']; nextOffset: number | null;
  expandedId?: string;
}
export interface HistoryMethods extends CommonMethods {
  afterRender(): void; afterSync(): Promise<void>; selectionChanged(): void;
  changeFilter(event: DatasetEvent<{ id: HistoryData['historyFilter'] }>): void;
  typeQuery(event: ValueEvent): void; loadHistory(append?: boolean): Promise<void>; loadMore(): void;
  expandContent(event: DatasetEvent): void; toggleMastery(event: DatasetEvent): Promise<void>; reviewToday(event: DatasetEvent): Promise<void>;
}
interface HistoryRuntime extends CommonRuntime { historyFamily?: string | null; historyRequest?: number; searchTimer?: ReturnType<typeof setTimeout> }
const base = common();
const definition: PageDefinition<HistoryData, HistoryMethods, HistoryRuntime> = {
  ...base,
  data: { ...base.data, historyItems: [], historyFilter: 'learned', query: '', historyBusy: false, historyError: '',
    historyCached: false, historyTotal: 0, stats: { learned: 0, mastered: 0, seen: 0 }, nextOffset: null },
  afterRender() {
    const familyId = this.data.family && this.data.family.id;
    if (this.historyFamily !== familyId) {
      this.historyFamily = familyId;
      this.setData({ historyItems: [], historyTotal: 0, stats: { learned: 0, mastered: 0, seen: 0 }, nextOffset: null });
    }
  },
  afterSync() { return this.loadHistory(); },
  selectionChanged() {
    this.setData({ historyItems: [], expandedId: '', nextOffset: null }); this.loadHistory();
  },
  changeFilter(event) { this.setData({ historyFilter: event.currentTarget.dataset.id }); this.selectionChanged(); },
  typeQuery(event) { this.setData({ query: event.detail.value }); clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.selectionChanged(), 350); },
  async loadHistory(append = false) {
    if (!this.data.family || !this.data.childId) return;
    const request = (this.historyRequest || 0) + 1; this.historyRequest = request;
    const signature = JSON.stringify([this.data.family.id, this.data.childId, this.data.subjectFilter, this.data.historyFilter, this.data.query]);
    const offset = append ? this.data.nextOffset : 0;
    if (offset === null) return;
    this.setData({ historyBusy: true, historyError: '' });
    try {
      const result = await this.engine.getHistory({ childId: this.data.childId, subject: this.data.subjectFilter,
        filter: this.data.historyFilter, query: this.data.query, offset });
      const current = JSON.stringify([this.data.family && this.data.family.id, this.data.childId, this.data.subjectFilter, this.data.historyFilter, this.data.query]);
      if (!this.active || this.historyRequest !== request || signature !== current) return;
      const items = result.items.map(decorate);
      const merged = append ? [...this.data.historyItems, ...items] : items;
      const unique = [...new Map(merged.map((item) => [item.contentId, item])).values()];
      this.setData({ historyItems: unique, historyTotal: result.total, stats: result.stats,
        nextOffset: result.nextOffset, historyCached: result.cached });
    } catch (error) {
      if (this.active && this.historyRequest === request) this.setData({ historyError: errorDetails(error).message || '回顾记录加载失败，请刷新' });
    } finally { if (this.historyRequest === request) this.setData({ historyBusy: false }); }
  },
  loadMore() { if (!this.data.historyBusy) this.loadHistory(true); },
  expandContent(event) { const id = event.currentTarget.dataset.id; this.setData({ expandedId: this.data.expandedId === id ? '' : id }); },
  async toggleMastery(event) {
    const item = this.data.historyItems.find((entry) => entry.contentId === event.currentTarget.dataset.id);
    if (!item) return;
    await this.perform('setMastery', { childId: this.data.childId, contentId: item.contentId, mastered: !item.mastered, baseVersion: item.version });
    await this.loadHistory();
  },
  async reviewToday(event) {
    const result = await this.perform('reviewContent', { childId: this.data.childId, contentId: event.currentTarget.dataset.id });
    if (result) { this.openToday(); wx.showToast({ title: result.task.done ? '今天已完成过这项内容' : '已安排到今日', icon: 'none' }); }
  },
  cleanup() { base.cleanup.call(this); clearTimeout(this.searchTimer); this.historyRequest = (this.historyRequest || 0) + 1; }
};
Page(definition);
