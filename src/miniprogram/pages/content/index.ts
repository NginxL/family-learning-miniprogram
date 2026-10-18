import { decorate } from '../../lib/page';
import * as learning from '../../lib/learning/learning';
import { pinyinFor, type PinyinText } from '../../lib/pinyin';
import { studyNotesView } from '../../lib/study-notes-view';
import { contentSchedule, type ContentScheduleData, type ContentScheduleMethods } from '../../lib/content-schedule';
import { learningGradeLabel, withContentSources } from '../../lib/content-presentation';
import type { ContentPreview, ContentSource, DetailItem } from '../../lib/content-detail';
import type { LearningApp } from '../../lib/client-models';
import type { PageDefinition, StudyNotesData, StudyNotesMethods } from '../../lib/page-types';
import type { SyncEngine } from '../../lib/sync-engine';

export interface ContentData extends StudyNotesData, ContentScheduleData {
  item: ReturnType<typeof withContentSources<DetailItem>> | null; pinyin: PinyinText | null; showPinyin: boolean;
  gradeLabels: string[]; gradeLabel: string; status: string; contextLabel: string; backLabel: string; pageError: string;
  canSchedule: boolean; assignedToday: boolean;
}
export interface ContentMethods extends StudyNotesMethods, ContentScheduleMethods {
  onLoad(query: Record<string, string | undefined>): void; onShow(): void; onHide(): void; onUnload(): void;
  render(): void; togglePinyin(): void; goBack(): void; arrangeContent(): void;
}
interface ContentRuntime {
  engine: SyncEngine; preview?: ContentPreview; source?: ContentSource; contentId?: string; active?: boolean;
  pinyinChoice?: boolean; unsubscribe?: () => boolean; channel?: WechatMiniprogram.EventChannel;
  receiveContent?: (value: ContentPreview) => void;
  assigning?: boolean;
  getOpenerEventChannel?(): WechatMiniprogram.EventChannel;
}
const notes = studyNotesView();
const scheduling = contentSchedule();
const definition: PageDefinition<ContentData, ContentMethods, ContentRuntime> = {
  ...notes,
  ...scheduling,
  data: { ...notes.data, ...scheduling.data, item: null, pinyin: null, showPinyin: false, gradeLabels: learning.gradeLabels,
    gradeLabel: '', status: '', contextLabel: '', backLabel: '返回知识库', pageError: '', canSchedule: false, assignedToday: false },
  onLoad(query) {
    this.engine = getApp<LearningApp>().engine;
    this.source = ['library', 'history', 'plan'].includes(query.source || '') ? query.source as ContentSource : undefined;
    this.contentId = query.id;
    this.setData({ backLabel: this.source === 'history' ? '返回回顾' : this.source === 'plan' ? '返回明日计划' : '返回知识库' });
    this.channel = this.getOpenerEventChannel?.();
    this.receiveContent = (value) => {
      if (value.source !== this.source || value.item.id !== this.contentId) return;
      this.preview = value;
      if (this.active) this.render();
    };
    this.channel?.on?.('showContent', this.receiveContent);
  },
  onShow() {
    this.active = true;
    this.setData({ busy: Boolean(this.assigning) });
    this.unsubscribe?.();
    this.unsubscribe = this.engine.subscribe(() => { if (this.active) this.render(); });
    this.render();
  },
  onHide() { this.active = false; this.unsubscribe?.(); this.setData({ assignTarget: null }); },
  onUnload() { this.onHide(); if (this.receiveContent) this.channel?.off?.('showContent', this.receiveContent); },
  render() {
    const preview = this.preview;
    const snapshot = this.engine.snapshot();
    const family = snapshot.family;
    const sameScope = Boolean(preview && snapshot.userId === preview.userId && family?.id === preview.familyId
      && family?.myRole === preview.role && (family?.myChildId || '') === preview.boundChild
      && family?.children.some(child => child.id === preview.childId));
    const knowledge = this.source === 'library' && this.contentId ? learning.catalogById.get(this.contentId) : undefined;
    // History and parent-entered plans always retain their actual selected text, even if a catalogue entry has changed.
    const item = this.source === 'library' ? knowledge && { ...decorate({ ...knowledge, subject: learning.definition(knowledge.kind).subject }), ...(knowledge.studyArea ? {
      kindLabel: knowledge.studyArea === 'literacy' ? '识字写字' : knowledge.studyArea === 'pinyin' ? '拼音练习' : '语文阅读' } : {}) } : sameScope ? preview?.item : null;
    this.setData({ item: item ? withContentSources(item) : null, pinyin: item ? pinyinFor(item) : null, showPinyin: this.pinyinChoice ?? preview?.showPinyin ?? false,
      gradeLabel: knowledge ? learningGradeLabel(knowledge) : sameScope ? preview?.gradeLabel || '' : '',
      status: sameScope ? preview?.status || '' : '', contextLabel: sameScope ? preview?.contextLabel || '' : '',
      childId: sameScope ? preview!.childId : '', canSchedule: Boolean(knowledge && sameScope && family?.myRole !== 'child'),
      assignedToday: Boolean(knowledge && sameScope && this.engine.viewDay(snapshot.today).tasks.some(task =>
        task.childId === preview!.childId && learning.contentId(task) === knowledge.id)),
      pageError: item ? '' : '当前内容暂不可查看，请返回列表重新选择。' });
    this.refreshAssignment();
  },
  arrangeContent() { if (this.data.canSchedule && this.source === 'library' && this.contentId) this.openAssignment(this.contentId, this.preview?.preferredDate); },
  togglePinyin() { this.pinyinChoice = !this.data.showPinyin; this.setData({ showPinyin: this.pinyinChoice }); },
  goBack() {
    const tab = this.source === 'history' ? 'history' : this.source === 'plan' ? 'plans' : 'library';
    wx.navigateBack({ fail() { wx.switchTab({ url: `/pages/${tab}/index` }); } });
  }
};
Page(definition);
