import { common, decorate } from '../../lib/page';
import * as learning from '../../lib/learning/learning';
import resources = require('../../lib/learning/resources');
import { shiftDate } from '../../lib/sync-engine';
import { pinyinFor, defaultPinyin, type PinyinText } from '../../lib/pinyin';
import type { ContentKind, ContentScope, KnowledgeItem, SchoolGrade } from '../../../shared/models';
import type { LearningApp } from '../../lib/client-models';
import type { CommonData, CommonMethods, CommonRuntime, DatasetEvent, Decorated, PageDefinition, PickerEvent, ValueEvent } from '../../lib/page-types';
export interface LibraryData extends CommonData {
  view: 'content' | 'exam' | 'books'; kinds: Array<{ id: ContentKind | ''; label: string }>; kindIndex: number;
  scopes: Array<{ id: ContentScope; label: string }>; scope: ContentScope; scopeIndex: number;
  query: string; items: Array<Decorated<KnowledgeItem> & { assigned: boolean; gradeLabel: string; preview?: string; pinyin: PinyinText | null }>;
  total: number; hasMore: boolean; expandedId: string; bookId: string; bookTitle: string; resources: typeof resources;
  grade: SchoolGrade | 0; gradeLabels: string[]; coverageOpen: boolean; poemCount: number; wordCount: number;
  filtersOpen: boolean; assignTarget: { id: string; title: string; familyId: string; childId: string; childName: string } | null;
  assignDate: string; tomorrow: string; maxPlanDate: string;
  showPinyin: boolean; readingCount: number; englishReadingCount: number;
  curriculumGradeIndex: number; curriculumGradeLabels: string[]; curriculumSlots: typeof resources.curriculum.slots;
}
export interface LibraryMethods extends CommonMethods {
  afterRender(): void; updateScopes(): void; selectionChanged(): void; updateItems(): void;
  changeView(event: DatasetEvent<{ id: LibraryData['view'] }>): void;
  changeKind(event: PickerEvent): void; changeScope(event: PickerEvent): void; changeGrade(event: PickerEvent): void;
  typeQuery(event: ValueEvent): void; loadMore(): void; expandContent(event: DatasetEvent): void; toggleCoverage(): void;
  showExamContent(event: DatasetEvent<{ kind: ContentKind }>): void;
  showBook(event: DatasetEvent): void; clearBook(): void; copySource(event: DatasetEvent<{ url: string }>): void;
  assignItem(event: DatasetEvent): void; closeAssign(): void; keepSheet(): void; toggleFilters(): void;
  chooseAssignDate(event: DatasetEvent<{ date: string }>): void; changeAssignDate(event: ValueEvent): void; confirmAssign(): Promise<void>;
  togglePinyin(): void;
  changeCurriculumGrade(event: PickerEvent): void;
}
interface LibraryRuntime extends CommonRuntime { matchSignature?: string; visibleLimit: number; preferredDate?: string; pinyinChoice?: { childId: string; enabled: boolean } }
const base = common();
const definition: PageDefinition<LibraryData, LibraryMethods, LibraryRuntime> = {
  ...base,
  data: { ...base.data, view: 'content', kinds: [{ id: '', label: '全部类型' }, ...learning.kinds.filter((kind) => kind.id !== 'math' && kind.id !== 'other')], kindIndex: 0,
    scopes: [{ id: 'all', label: '全部可用内容' }, { id: 'starter', label: '亲子入门' }], scope: 'all', scopeIndex: 0,
    query: '', items: [], total: 0, hasMore: false, expandedId: '', bookId: '', bookTitle: '', resources,
    grade: 0, gradeLabels: ['全部年级 / 待核对', ...learning.gradeLabels.slice(1)],
    coverageOpen: false, poemCount: learning.catalog.filter((item) => item.kind === 'poetry').length,
    wordCount: learning.catalog.filter((item) => item.kind === 'word').length, filtersOpen: false,
    assignTarget: null, assignDate: '', tomorrow: '', maxPlanDate: '', showPinyin: false,
    readingCount: learning.catalog.filter((item) => item.kind === 'reading').length,
    englishReadingCount: learning.catalog.filter((item) => item.kind === 'english-reading').length,
    curriculumGradeIndex: 0, curriculumGradeLabels: learning.gradeLabels.slice(1),
    curriculumSlots: resources.curriculum.slots.filter(slot => slot.grade === 1) },
  onShow() {
    base.onShow.call(this);
    const navigation = getApp<LearningApp>().navigation || {};
    this.preferredDate = navigation.libraryDate; delete navigation.libraryDate;
    if (navigation.libraryKind !== undefined) {
      const kindIndex = this.data.kinds.findIndex((item) => item.id === navigation.libraryKind);
      this.setData({ kindIndex: Math.max(0, kindIndex), scope: navigation.libraryScope || 'all', grade: 0, bookId: '', bookTitle: '', view: 'content' });
      delete navigation.libraryKind; delete navigation.libraryScope;
    }
    if (navigation.libraryGrade !== undefined) {
      this.setData({ grade: navigation.libraryGrade, kindIndex: 0, scope: 'all', subjectFilter: 'all', bookId: '', bookTitle: '', query: '', view: 'content' });
      delete navigation.libraryGrade;
    }
    if (navigation.libraryView === 'exam') { this.setData({ view: 'exam' }); delete navigation.libraryView; }
    this.updateScopes(); this.updateItems();
  },
  onHide() { this.setData({ assignTarget: null }); base.onHide.call(this); },
  afterRender() {
    const target = this.data.assignTarget;
    this.setData({ subjectOptions: this.data.subjectOptions.filter((subject) => subject.id !== 'math' && subject.id !== 'other'),
      showPinyin: this.pinyinChoice?.childId === this.data.childId ? this.pinyinChoice.enabled : defaultPinyin(this.data.children.find((child) => child.id === this.data.childId)?.schoolGrade),
      ...(this.data.subjectFilter === 'math' || this.data.subjectFilter === 'other' ? { subjectFilter: 'all' as const } : {}),
      tomorrow: shiftDate(this.data.today, 1), maxPlanDate: shiftDate(this.data.today, 365),
      ...(target && (target.familyId !== this.data.family?.id || target.childId !== this.data.childId || this.data.isChild) ? { assignTarget: null } : {}) });
    this.updateItems();
  },
  updateScopes() {
    const kind = this.data.kinds[this.data.kindIndex].id;
    const scopes: LibraryData['scopes'] = kind ? learning.scopeOptions(kind) : [{ id: 'all', label: '全部可用内容' }, { id: 'starter', label: '亲子入门' }];
    const scope = scopes.some((item) => item.id === this.data.scope) ? this.data.scope : 'all';
    this.setData({ scopes, scope, scopeIndex: scopes.findIndex((item) => item.id === scope) });
  },
  selectionChanged() {
    this.setData({ kindIndex: 0, scope: 'all', bookId: '', bookTitle: '' });
    this.updateScopes(); this.updateItems();
  },
  updateItems() {
    const kind = this.data.kinds[this.data.kindIndex].id;
    const signature = JSON.stringify([kind, this.data.subjectFilter, this.data.scope, this.data.query, this.data.bookId, this.data.grade]);
    if (signature !== this.matchSignature) { this.matchSignature = signature; this.visibleLimit = 30; }
    const matches = learning.searchCatalog({ kind: kind || undefined, subject: this.data.subjectFilter, scope: this.data.scope, query: this.data.query, bookId: this.data.bookId, grade: this.data.grade || undefined });
    const today = this.engine ? this.engine.viewDay(this.data.today).tasks.filter((task) => task.childId === this.data.childId) : [];
    this.setData({ total: matches.length, hasMore: matches.length > this.visibleLimit,
      items: matches.slice(0, this.visibleLimit).map((item) => ({ ...decorate({ ...item, subject: learning.definition(item.kind).subject }),
        pinyin: pinyinFor(item),
        assigned: today.some((task) => learning.contentId(task) === item.id),
        gradeLabel: (item.gradeMappings || []).length ? [...new Set(item.gradeMappings!.map((mapping) => learning.gradeLabels[mapping.grade]))].join('、') + ' · 教材目录已核实' : ['reading', 'english-reading'].includes(item.kind) ? '自编入门练习 · 非教材课文' : '年级归属待核对',
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
    this.setData({ kindIndex, bookId: '', bookTitle: '', subjectFilter: kind ? learning.definition(kind).subject : 'all' });
    this.rememberSelection(); this.updateScopes(); this.updateItems();
  },
  changeScope(event) { this.setData({ scopeIndex: Number(event.detail.value), scope: this.data.scopes[Number(event.detail.value)].id }); this.updateItems(); },
  changeGrade(event) { this.setData({ grade: Number(event.detail.value) as SchoolGrade | 0, bookId: '', bookTitle: '' }); this.updateItems(); },
  typeQuery(event) { this.setData({ query: event.detail.value }); this.updateItems(); },
  loadMore() { this.visibleLimit += 30; this.updateItems(); },
  expandContent(event) { const id = event.currentTarget.dataset.id; this.setData({ expandedId: this.data.expandedId === id ? '' : id }); },
  toggleCoverage() { this.setData({ coverageOpen: !this.data.coverageOpen }); },
  toggleFilters() { this.setData({ filtersOpen: !this.data.filtersOpen }); },
  togglePinyin() { this.pinyinChoice = { childId: this.data.childId, enabled: !this.data.showPinyin }; this.setData({ showPinyin: this.pinyinChoice.enabled }); },
  showExamContent(event) {
    const kind = event.currentTarget.dataset.kind;
    const kindIndex = this.data.kinds.findIndex((item) => item.id === kind);
    if (kindIndex < 1) return;
    this.setData({ kindIndex, scope: 'all', grade: 0, bookId: '', bookTitle: '', query: '',
      subjectFilter: learning.definition(kind).subject, view: 'content' });
    this.updateScopes(); this.updateItems();
  },
  showBook(event) {
    const book = resources.books.find((item) => item.id === event.currentTarget.dataset.id)!;
    this.setData({ bookId: book.id, bookTitle: book.title, kindIndex: 1, scope: 'all', grade: 0, subjectFilter: 'poetry', query: '', view: 'content' });
    this.updateScopes(); this.updateItems();
  },
  clearBook() { this.setData({ bookId: '', bookTitle: '' }); this.updateItems(); },
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
