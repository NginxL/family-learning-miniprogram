import { decorate } from './page';
import { defaultPinyin } from './pinyin';
import type { ContentInput, GradeMapping } from '../../shared/models';
import type { Decorated } from './page-types';
import type { LearningApp } from './client-models';

export type ContentSource = 'library' | 'history' | 'plan';
type ContentWithEvidence = ContentInput & { gradeMappings?: GradeMapping[]; referenceUrl?: string; textSourceUrl?: string };
export type DetailItem = Decorated<ContentWithEvidence> & { title: string; detail: string };
export interface ContentPreview {
  source: ContentSource; item: DetailItem; childId: string; gradeLabel: string; status: string; contextLabel: string;
  showPinyin: boolean; userId: string | null; familyId: string; role: string; boundChild: string;
}
let opening = false;
export function openContentDetail(source: ContentSource, item: ContentWithEvidence, childId: string,
  labels: { gradeLabel?: string; status?: string; contextLabel?: string; showPinyin?: boolean } = {}): void {
  if (opening) return;
  const { engine } = getApp<LearningApp>();
  const snapshot = engine.snapshot();
  const family = snapshot.family;
  const child = family?.children.find(entry => entry.id === childId);
  if (source !== 'library' && (!child || !family || !snapshot.userId)) return;
  // Send an isolated view snapshot, never a body in a URL or a new persisted learning record.
  const preview: ContentPreview = JSON.parse(JSON.stringify({ source,
    item: decorate({ ...item, title: item.title || '学习内容', detail: item.detail || '' }), childId,
    gradeLabel: labels.gradeLabel || '', status: labels.status || '', contextLabel: labels.contextLabel || '',
    showPinyin: labels.showPinyin ?? defaultPinyin(child?.schoolGrade), userId: snapshot.userId,
    familyId: family?.id || '', role: family?.myRole || '', boundChild: family?.myChildId || '' }));
  opening = true;
  wx.navigateTo({ url: `/pages/content/index?source=${source}&id=${encodeURIComponent(item.id)}`,
    success(result) { result.eventChannel.emit('showContent', preview); },
    fail() { wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }); },
    complete() { opening = false; } });
}
