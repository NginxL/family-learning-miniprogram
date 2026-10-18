import { common, decorate } from '../../lib/page';
import * as learning from '../../lib/learning/learning';
import resources = require('../../lib/learning/resources');
import { shiftDate } from '../../lib/sync-engine';
import { pinyinFor, defaultPinyin, type PinyinText } from '../../lib/pinyin';
import { errorDetails } from '../../lib/errors';
import { openContentDetail } from '../../lib/content-detail';
import type { ApiResults } from '../../../shared/api';
import type { ContentKind, ContentScope, KnowledgeItem, LearningArea, SchoolGrade } from '../../../shared/models';
import type { LearningApp } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, PageDefinition, PickerEvent, ValueEvent } from '../../lib/page-types';
export interface LibraryData extends CommonData {
  view: 'content' | 'exam' | 'books'; kinds: Array<{ id: ContentKind | ''; label: string }>; kindIndex: number;
  scopes: Array<{ id: ContentScope; label: string }>; scope: ContentScope; scopeIndex: number;
  query: string; items: Array<Decorated<KnowledgeItem> & { assigned: boolean; gradeLabel: string; preview?: string; pinyin: PinyinText | null;
    learnedLabel: string; lastLearned: string; learnedCount: number }>;
  total: number; hasMore: boolean; bookId: string; bookTitle: string; resources: typeof resources;
  grade: SchoolGrade | 0; gradeLabels: string[]; coverageOpen: boolean; poemCount: number; wordCount: number;
  filtersOpen: boolean; assignTarget: { id: string; title: string; familyId: string; childId: string; childName: string } | null;
  assignDate: string; tomorrow: string; maxPlanDate: string;
  showPinyin: boolean; readingCount: number; englishReadingCount: number;
  foundationCount: number; learningAreaIndex: number; learningAreas: Array<{ id: LearningArea | ''; label: string }>;
  curriculumGradeIndex: number; curriculumGradeLabels: string[]; curriculumSlots: typeof resources.curriculum.slots;
  semesterIndex: number; semesterLabels: string[]; bookUnits: Array<{ id: string; label: string }>; unitIndex: number;
  learningFilterIndex: number; learningFilterLabels: string[]; learningReady: boolean; learningBusy: boolean; learningCached: boolean; learningError: string;
}
export interface LibraryMethods extends CommonMethods {
  afterRender(): void; updateScopes(): void; selectionChanged(): void; updateItems(): void;
  changeView(event: DatasetEvent<{ id: LibraryData['view'] }>): void;
  changeKind(event: PickerEvent): void; changeScope(event: PickerEvent): void; changeGrade(event: PickerEvent): void;
  typeQuery(event: ValueEvent): void; loadMore(): void; openContent(event: DatasetEvent): void; toggleCoverage(): void;
  showExamContent(event: DatasetEvent<{ kind: ContentKind; area?: LearningArea }>): void;
  changeLearningArea(event: PickerEvent): void;
  showBook(event: DatasetEvent): void; clearBook(): void; copySource(event: DatasetEvent<{ url: string }>): void;
  assignItem(event: DatasetEvent): void; closeAssign(): void; keepSheet(): void; toggleFilters(): void;
  chooseAssignDate(event: DatasetEvent<{ date: string }>): void; changeAssignDate(event: ValueEvent): void; confirmAssign(): Promise<void>;
  togglePinyin(): void;
  changeCurriculumGrade(event: PickerEvent): void;
  changeSemester(event: PickerEvent): void; changeUnit(event: PickerEvent): void;
  afterSync(): Promise<void>; loadLearningStatus(): Promise<void>; changeLearningFilter(event: PickerEvent): void;
}
interface LibraryRuntime extends CommonRuntime { matchSignature?: string; visibleLimit: number; preferredDate?: string; pinyinChoice?: { childId: string; enabled: boolean };
  learningScope?: string; learningRequest?: number; learningIndex?: Map<string, ApiResults['getLearningStatus']['items'][number]> }
const base = common();
const definition: PageDefinition<LibraryData, LibraryMethods, LibraryRuntime> = {
  ...base,
  data: { ...base.data, view: 'content', kinds: [{ id: '', label: '全部类型' }, ...learning.kinds.filter((kind) => kind.id !== 'math' && kind.id !== 'other')], kindIndex: 0,
    scopes: [{ id: 'all', label: '全部可用内容' }, { id: 'starter', label: '亲子入门' }], scope: 'all', scopeIndex: 0,
    query: '', items: [], total: 0, hasMore: false, bookId: '', bookTitle: '', resources,
    grade: 0, gradeLabels: ['全部年级 / 待核对', ...learning.gradeLabels.slice(1)],
    coverageOpen: false, poemCount: learning.catalog.filter((item) => item.kind === 'poetry').length,
    wordCount: learning.catalog.filter((item) => item.kind === 'word').length, filtersOpen: false,
    assignTarget: null, assignDate: '', tomorrow: '', maxPlanDate: '', showPinyin: false,
    readingCount: learning.catalog.filter((item) => item.kind === 'reading' && !item.learningArea).length,
    englishReadingCount: learning.catalog.filter((item) => item.kind === 'english-reading' && !item.learningArea).length,
    foundationCount: learning.catalog.filter(item => item.learningArea).length,
    learningAreaIndex: 0, learningAreas: [{ id: '', label: '全部学习方向' }, ...learning.learningAreas],
    curriculumGradeIndex: 0, curriculumGradeLabels: learning.gradeLabels.slice(1),
    curriculumSlots: resources.curriculum.slots.filter(slot => slot.grade === 1),
    semesterIndex: 0, semesterLabels: ['全部学期', '上册', '下册'], bookUnits: [{ id: '', label: '全册内容' }], unitIndex: 0,
    learningFilterIndex: 0, learningFilterLabels: ['全部学习状态', '还未学过', '已经学过'], learningReady: false, learningBusy: false, learningCached: false, learningError: '' },
  onShow() {
    base.onShow.call(this);
    const navigation = getApp<LearningApp>().navigation || {};
    this.preferredDate = navigation.libraryDate; delete navigation.libraryDate;
    if (navigation.libraryKind !== undefined) {
      this.setData({ learningAreaIndex: 0 });
      const kindIndex = this.data.kinds.findIndex((item) => item.id === navigation.libraryKind);
      this.setData({ kindIndex: Math.max(0, kindIndex), scope: navigation.libraryScope || 'all', grade: 0, bookId: '', bookTitle: '', view: 'content',
        semesterIndex: 0, unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] });
      delete navigation.libraryKind; delete navigation.libraryScope;
    }
    if (navigation.libraryGrade !== undefined) {
      this.setData({ learningAreaIndex: 0 });
      this.setData({ grade: navigation.libraryGrade, kindIndex: 0, scope: 'all', subjectFilter: 'all', bookId: '', bookTitle: '', query: '', view: 'content',
        semesterIndex: 0, unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] });
      delete navigation.libraryGrade;
    }
    if (navigation.libraryView === 'exam') { this.setData({ view: 'exam' }); delete navigation.libraryView; }
    this.updateScopes(); this.updateItems();
  },
  onHide() { this.setData({ assignTarget: null }); base.onHide.call(this); },
  afterRender() {
    const scope = JSON.stringify([this.data.family?.id, this.data.childId]);
    if (this.learningScope !== scope) {
      this.learningScope = scope; this.learningIndex = new Map(); this.learningRequest = (this.learningRequest || 0) + 1;
      this.setData({ learningReady: false, learningBusy: false, learningCached: false, learningError: '' });
      if (this.active) void this.loadLearningStatus();
    }
    const target = this.data.assignTarget;
    this.setData({ subjectOptions: this.data.subjectOptions.filter((subject) => subject.id !== 'math' && subject.id !== 'other'),
      showPinyin: this.pinyinChoice?.childId === this.data.childId ? this.pinyinChoice.enabled : defaultPinyin(this.data.children.find((child) => child.id === this.data.childId)?.schoolGrade),
      ...(this.data.subjectFilter === 'math' || this.data.subjectFilter === 'other' ? { subjectFilter: 'all' as const } : {}),
      tomorrow: shiftDate(this.data.today, 1), maxPlanDate: shiftDate(this.data.today, 365),
      ...(target && (target.familyId !== this.data.family?.id || target.childId !== this.data.childId || this.data.isChild) ? { assignTarget: null } : {}) });
    this.updateItems();
  },
  afterSync() { return this.loadLearningStatus(); },
  async loadLearningStatus() {
    if (!this.data.family || !this.data.childId || !this.active) return;
    const request = (this.learningRequest || 0) + 1; this.learningRequest = request;
    const scope = JSON.stringify([this.data.family.id, this.data.childId]);
    this.setData({ learningBusy: true, learningError: '' });
    try {
      const result = await this.engine.getLearningStatus({ childId: this.data.childId });
      if (!this.active || request !== this.learningRequest || scope !== this.learningScope) return;
      this.learningIndex = new Map(result.items.map(item => [item.contentId, item]));
      this.setData({ learningReady: true, learningCached: result.cached }); this.updateItems();
    } catch (error) {
      if (this.active && request === this.learningRequest && scope === this.learningScope)
        this.setData({ learningCached: this.data.learningReady, learningError: errorDetails(error).message || '学习记录暂未加载，请刷新重试' });
    } finally { if (this.active && request === this.learningRequest) this.setData({ learningBusy: false }); }
  },
  changeLearningFilter(event) {
    const index = Number(event.detail.value); if (!Number.isInteger(index) || index < 0 || index > 2) return;
    this.setData({ learningFilterIndex: index }); this.updateItems();
  },
  cleanup() { base.cleanup.call(this); this.learningRequest = (this.learningRequest || 0) + 1; },
  updateScopes() {
    const kind = this.data.kinds[this.data.kindIndex].id;
    const scopes: LibraryData['scopes'] = kind ? learning.scopeOptions(kind) : [{ id: 'all', label: '全部可用内容' }, { id: 'starter', label: '亲子入门' }];
    const scope = scopes.some((item) => item.id === this.data.scope) ? this.data.scope : 'all';
    this.setData({ scopes, scope, scopeIndex: scopes.findIndex((item) => item.id === scope) });
  },
  selectionChanged() {
    this.setData({ kindIndex: 0, scope: 'all', bookId: '', bookTitle: '', unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }], learningAreaIndex: 0 });
    this.updateScopes(); this.updateItems();
  },
  updateItems() {
    const kind = this.data.kinds[this.data.kindIndex].id;
    const semester = this.data.semesterIndex ? this.data.semesterLabels[this.data.semesterIndex] as '上册' | '下册' : undefined;
    const unitId = this.data.bookUnits[this.data.unitIndex]?.id || undefined;
    const learningArea = this.data.learningAreas[this.data.learningAreaIndex].id || undefined;
    const signature = JSON.stringify([kind, this.data.subjectFilter, this.data.scope, this.data.query, this.data.bookId, this.data.grade, semester, unitId, learningArea, this.data.learningFilterIndex, this.data.childId]);
    if (signature !== this.matchSignature) { this.matchSignature = signature; this.visibleLimit = 30; }
    const matches = learning.searchCatalog({ kind: kind || undefined, subject: this.data.subjectFilter, scope: this.data.scope, query: this.data.query, bookId: this.data.bookId, grade: this.data.grade || undefined, semester, unitId, learningArea })
      .filter(item => !this.data.learningReady || !this.data.learningFilterIndex || (this.data.learningFilterIndex === 2) === Boolean(this.learningIndex?.has(item.id)));
    const today = this.engine ? this.engine.viewDay(this.data.today).tasks.filter((task) => task.childId === this.data.childId) : [];
    this.setData({ total: matches.length, hasMore: matches.length > this.visibleLimit,
      items: matches.slice(0, this.visibleLimit).map((item) => ({ ...decorate({ ...item, subject: learning.definition(item.kind).subject }),
        pinyin: pinyinFor(item),
        gradeMappings: (item.gradeMappings || []).map(mapping => ({ ...mapping, displayKey: `${mapping.bookId}:${mapping.unitId || mapping.outlineDestination}` })),
        ...(item.studyArea ? { kindLabel: item.studyArea === 'literacy' ? '识字写字' : item.studyArea === 'pinyin' ? '拼音练习' : '语文阅读' } : {}),
        assigned: today.some((task) => learning.contentId(task) === item.id),
        learnedLabel: this.learningIndex?.has(item.id) ? (this.learningIndex.get(item.id)!.mastered ? '已掌握' : '已学过') : '',
        lastLearned: this.learningIndex?.get(item.id)?.lastLearned || '', learnedCount: this.learningIndex?.get(item.id)?.learnedCount || 0,
        gradeLabel: learning.knowledgeGradeLabel(item),
        preview: item.kind === 'poetry' ? decorate(item).poetryByline : item.detail.split('\n')[1] || '' })) });
  },
  changeView(event) { this.setData({ view: event.currentTarget.dataset.id }); },
  changeCurriculumGrade(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index > 8) return;
    this.setData({ curriculumGradeIndex: index, curriculumSlots: resources.curriculum.slots.filter(slot => slot.grade === index + 1) });
  },
  changeKind(event) {
    const kindIndex = Number(event.detail.value); const kind = this.data.kinds[kindIndex].id;
    this.setData({ kindIndex, learningAreaIndex: 0, bookId: '', bookTitle: '', unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }], subjectFilter: kind ? learning.definition(kind).subject : 'all' });
    this.rememberSelection(); this.updateScopes(); this.updateItems();
  },
  changeLearningArea(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.learningAreas.length) return;
    this.setData({ learningAreaIndex: index, kindIndex: 0, scope: 'all', subjectFilter: 'all', bookId: '', bookTitle: '',
      unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] });
    this.updateScopes(); this.updateItems();
  },
  changeScope(event) { this.setData({ scopeIndex: Number(event.detail.value), scope: this.data.scopes[Number(event.detail.value)].id }); this.updateItems(); },
  changeGrade(event) { this.setData({ grade: Number(event.detail.value) as SchoolGrade | 0, bookId: '', bookTitle: '', unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] }); this.updateItems(); },
  changeSemester(event) {
    const index = Number(event.detail.value); if (!Number.isInteger(index) || index < 0 || index > 2) return;
    this.setData({ semesterIndex: index, bookId: '', bookTitle: '', unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] }); this.updateItems();
  },
  changeUnit(event) {
    const index = Number(event.detail.value); if (!Number.isInteger(index) || index < 0 || index >= this.data.bookUnits.length) return;
    this.setData({ unitIndex: index }); this.updateItems();
  },
  typeQuery(event) { this.setData({ query: event.detail.value }); this.updateItems(); },
  loadMore() { this.visibleLimit += 30; this.updateItems(); },
  openContent(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    const sameFamily = this.engine.snapshot().family?.id === this.data.family?.id;
    openContentDetail('library', item, this.data.childId, { gradeLabel: item.gradeLabel, status: sameFamily ? item.learnedLabel : '',
      contextLabel: sameFamily && item.lastLearned ? `最近学习 ${item.lastLearned} · 已学 ${item.learnedCount} 天` : '', showPinyin: this.data.showPinyin });
  },
  toggleCoverage() { this.setData({ coverageOpen: !this.data.coverageOpen }); },
  toggleFilters() { this.setData({ filtersOpen: !this.data.filtersOpen }); },
  togglePinyin() { this.pinyinChoice = { childId: this.data.childId, enabled: !this.data.showPinyin }; this.setData({ showPinyin: this.pinyinChoice.enabled }); },
  showExamContent(event) {
    const kind = event.currentTarget.dataset.kind;
    const kindIndex = this.data.kinds.findIndex((item) => item.id === kind);
    if (kindIndex < 1) return;
    this.setData({ kindIndex, scope: 'all', grade: 0, bookId: '', bookTitle: '', query: '', semesterIndex: 0, unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }],
      learningAreaIndex: Math.max(0, this.data.learningAreas.findIndex(area => area.id === event.currentTarget.dataset.area)),
      subjectFilter: learning.definition(kind).subject, view: 'content' });
    this.updateScopes(); this.updateItems();
  },
  showBook(event) {
    const book = resources.books.find((item) => item.id === event.currentTarget.dataset.id);
    if (!book) return;
    this.setData({ bookId: book.id, bookTitle: book.title, kindIndex: 0, scope: 'all', grade: 0, subjectFilter: 'all', query: '', view: 'content', learningAreaIndex: 0,
      semesterIndex: 0, unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }, ...(book.units || [])] });
    this.updateScopes(); this.updateItems();
  },
  clearBook() { this.setData({ bookId: '', bookTitle: '', unitIndex: 0, bookUnits: [{ id: '', label: '全册内容' }] }); this.updateItems(); },
  copySource(event) {
    const url = event.currentTarget.dataset.url;
    if (typeof url === 'string' && url.startsWith('https://')) wx.setClipboardData({ data: url });
  },
  assignItem(event) {
    if (!this.data.family || this.data.isChild || this.data.busy) return;
    const item = this.data.items.find((item) => item.id === event.currentTarget.dataset.id);
    const child = this.data.children.find((child) => child.id === this.data.childId);
    if (!item || !child) return;
    this.setData({ assignTarget: { id: item.id, title: item.title, familyId: this.data.family.id, childId: child.id, childName: child.name },
      assignDate: this.preferredDate && this.preferredDate >= this.data.today && this.preferredDate <= this.data.maxPlanDate ? this.preferredDate : this.data.today });
  },
  closeAssign() { if (!this.data.busy) this.setData({ assignTarget: null }); },
  keepSheet() {},
  chooseAssignDate(event) { if (!this.data.busy) this.setData({ assignDate: event.currentTarget.dataset.date }); },
  changeAssignDate(event) { if (!this.data.busy) this.setData({ assignDate: event.detail.value }); },
  async confirmAssign() {
    const target = this.data.assignTarget; const date = this.data.assignDate;
    if (!target || target.familyId !== this.data.family?.id || target.childId !== this.data.childId || this.data.isChild) return;
    const result = await this.perform('assignContent', { childId: target.childId, contentId: target.id, date });
    if (result && this.data.assignTarget === target) {
      this.setData({ assignTarget: null });
      const label = date === this.data.today ? '今日' : date === this.data.tomorrow ? '明日' : date;
      wx.showToast({ title: `已加入${label}`, icon: 'none' });
    }
  }
};
Page(definition);
