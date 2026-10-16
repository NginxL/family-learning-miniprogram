import { parseTaskRoute, type TaskRouteQuery } from '../../lib/task-route';
import { choosePhotos, draftId, privacyConsent, readBase64, removePreview, writePreview, startRecording, type Recording, type DraftAttachment } from '../../lib/homework-media';
import { groupTasks } from '../../lib/task-groups';
import { errorDetails } from '../../lib/errors';
import type { HomeworkScope, HomeworkView } from '../../../shared/models';
import type { LearningApp } from '../../lib/client-models';
import type { DatasetEvent, PageDefinition, ValueEvent } from '../../lib/page-types';
import type { SyncEngine } from '../../lib/sync-engine';
export interface HomeworkData {
  childName: string; label: string; date: string; isChild: boolean; valid: boolean; done: boolean;
  busy: boolean; loading: boolean; recording: boolean; playingId: string; error: string; feedback: string;
  homework: HomeworkView | null; statusLabel: string; drafts: DraftAttachment[]; privacyRequired: boolean;
}
export interface HomeworkMethods {
  onLoad(query: TaskRouteQuery): void; onShow(): void; onHide(): void; onUnload(): void; onPullDownRefresh(): Promise<void>;
  render(): void; refresh(): Promise<void>; current(): HomeworkScope | null;
  takePhoto(): Promise<void>; record(): Promise<void>; removeDraft(event: DatasetEvent): void;
  submit(): Promise<void>; approve(): Promise<void>; returnWork(): Promise<void>; review(decision: 'approve' | 'return'): Promise<void>;
  changeFeedback(event: ValueEvent): void; preview(event: DatasetEvent): Promise<void>; previewDraft(event: DatasetEvent): void;
  play(path: string, id: string): void; stopMedia(): void; openToday(): void;
  consent(): Promise<void>; agreePrivacy(): void; declinePrivacy(): void; openPrivacy(): void;
}
interface Runtime {
  engine: SyncEngine; taskContext?: HomeworkScope | null; active?: boolean; requestId: number;
  files: DraftAttachment[]; submissionId: string; previews: Record<string, string>; audio?: WechatMiniprogram.InnerAudioContext;
  recording?: Recording;
  privacyResolve?: (accepted: boolean) => void; viewingPrivacy?: boolean;
  timer?: ReturnType<typeof setInterval>; unsubscribe?: () => boolean;
}
const labels = { pending: '待家长确认', approved: '家长已确认完成', returned: '请修改后重新提交' };
const definition: PageDefinition<HomeworkData, HomeworkMethods, Runtime> = {
  data: { childName: '', label: '', date: '', isChild: false, valid: false, done: false, busy: false, loading: false,
    recording: false, playingId: '', error: '', feedback: '', homework: null, statusLabel: '', drafts: [], privacyRequired: false },
  onLoad(query) {
    this.engine = getApp<LearningApp>().engine; this.taskContext = parseTaskRoute(query, this.engine.today);
    this.files = []; this.previews = {}; this.submissionId = draftId(); this.requestId = 0;
  },
  onShow() {
    this.active = true; this.render(); this.refresh();
    this.unsubscribe = this.engine.subscribe(() => { if (this.active) this.render(); });
    this.timer = setInterval(() => { if (!this.data.busy) this.refresh(); }, 20000);
  },
  onHide() {
    this.active = false; this.requestId++; this.unsubscribe?.(); clearInterval(this.timer); this.stopMedia();
    if (!this.viewingPrivacy) this.declinePrivacy();
    this.setData({ recording: false, playingId: '' });
  },
  onUnload() {
    this.onHide();
    this.declinePrivacy();
    Object.values(this.previews).forEach(removePreview);
  },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  current() {
    const scope = this.taskContext; const family = this.engine.snapshot().family;
    return scope && family?.id === scope.familyId && family.children.some((child) => child.id === scope.childId)
      && (family.myRole !== 'child' || family.myChildId === scope.childId) ? scope : null;
  },
  render() {
    const scope = this.current(); const family = this.engine.snapshot().family;
    const group = scope ? groupTasks(this.engine.viewDay(scope.date).tasks.filter((task) => task.childId === scope.childId)).find((item) => item.id === scope.kind) : null;
    if (!scope || !group) { this.setData({ valid: false, homework: null, drafts: [], childName: '', error: '学习档案或任务已变更，请返回今日重新打开。' }); return; }
    this.setData({ valid: true, isChild: family?.myRole === 'child', childName: family?.children.find((child) => child.id === scope.childId)?.name || '',
      date: scope.date, label: group.label, done: group.done, drafts: this.files });
  },
  async refresh() {
    const scope = this.current(); if (!scope) return;
    const request = ++this.requestId;
    this.setData({ loading: true, error: '' });
    try {
      await this.engine.sync(scope.date);
      if (!this.current()) { this.render(); return; }
      const result = await this.engine.transport('getHomework', scope);
      if (!this.active || request !== this.requestId || !this.current()) return;
      this.setData({ homework: result.homework, statusLabel: result.homework ? labels[result.homework.status] : '尚未提交作业' });
    } catch (error) {
      if (this.active && request === this.requestId) this.setData({ error: errorDetails(error).message || '作业读取失败，请联网后重试' });
    } finally { if (this.active && request === this.requestId) this.setData({ loading: false }); }
  },
  async takePhoto() {
    if (!this.current() || !this.data.isChild || this.data.busy || this.data.recording || this.files.length >= 3) return;
    this.setData({ busy: true, error: '' });
    try { await this.consent(); if (!this.active || !this.current()) return;
      const files = await choosePhotos(3 - this.files.length); if (this.current()) { this.files.push(...files); this.submissionId = draftId(); if (this.active) this.render(); } }
    catch (error) { if (this.active) this.setData({ error: errorDetails(error).message || '无法添加照片' }); }
    finally { this.setData({ busy: false }); }
  },
  async record() {
    if (this.data.recording) { this.recording?.stop(); return; }
    if (!this.current() || !this.data.isChild || this.data.busy || this.files.length >= 3) return;
    this.setData({ busy: true, error: '' });
    try {
      await this.consent();
      if (!this.active || !this.current()) return;
      await new Promise<void>((resolve, reject) => wx.authorize({ scope: 'scope.record', success: () => resolve(),
        fail: () => reject(new Error('请在微信小程序设置中允许麦克风权限')) }));
      if (!this.active || !this.current()) return;
      this.setData({ recording: true });
      this.recording = startRecording((result) => {
          if (!this.active || !this.current()) return;
          this.setData({ recording: false });
          if (result.duration < 300 || result.fileSize > 512 * 1024) { this.setData({ error: '录音过短或过大，请重新录制' }); return; }
          this.files.push({ id: draftId(), path: result.tempFilePath, mime: 'audio/mpeg', duration: Math.min(60, result.duration / 1000) });
          this.submissionId = draftId(); this.render();
        }, () => { if (this.active) this.setData({ recording: false, error: '录音失败，请检查麦克风权限后重试' }); });
    } catch (error) { if (this.active) this.setData({ recording: false, error: errorDetails(error).message || '无法开始录音' }); }
    finally { this.setData({ busy: false }); }
  },
  removeDraft(event) {
    if (this.data.busy || this.data.recording) return;
    this.files = this.files.filter((file) => file.id !== event.currentTarget.dataset.id); this.submissionId = draftId(); this.render();
  },
  async submit() {
    const scope = this.current();
    if (!scope || !this.data.isChild || this.data.busy || this.data.loading || this.data.recording || !this.files.length) return;
    this.setData({ busy: true, error: '' });
    try {
      for (const file of this.files) {
        if (!this.current()) throw new Error('孩子绑定状态已变更，请重新打开');
        if (!file.attachmentId) {
          const result = await this.engine.transport('uploadHomeworkAttachment', { ...scope, uploadId: file.id, mime: file.mime,
            duration: file.duration, base64: await readBase64(file.path) });
          file.attachmentId = result.attachmentId;
        }
      }
      const result = await this.engine.transport('submitHomework', { ...scope, submissionId: this.submissionId,
        attachmentIds: this.files.map((file) => file.attachmentId!), baseVersion: this.data.homework?.version || 0 });
      this.files = []; this.submissionId = draftId();
      if (this.active && this.current()) { this.setData({ homework: result.homework, statusLabel: labels[result.homework.status] }); this.render(); wx.showToast({ title: '已提交，等家长确认', icon: 'none' }); }
    } catch (error) { if (this.active) this.setData({ error: errorDetails(error).message || '未提交成功，请联网后重试；附件保留在本页' }); }
    finally { this.setData({ busy: false }); }
  },
  async approve() { await this.review('approve'); },
  async returnWork() { await this.review('return'); },
  async review(decision) {
    const scope = this.current(); const homework = this.data.homework;
    if (!scope || this.data.isChild || this.data.busy || !homework || homework.status !== 'pending') return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await this.engine.transport('reviewHomework', { ...scope, baseVersion: homework.version, decision, feedback: this.data.feedback });
      if (this.active && this.current()) this.setData({ homework: result.homework, statusLabel: labels[result.homework.status], feedback: '' });
      await this.engine.sync(scope.date);
    } catch (error) { if (this.active) this.setData({ error: errorDetails(error).message || '确认失败，请刷新后重试' }); }
    finally { this.setData({ busy: false }); }
  },
  changeFeedback(event) { this.setData({ feedback: event.detail.value }); },
  async preview(event) {
    const scope = this.current(); const file = this.data.homework?.attachments.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!scope || !file || this.data.busy || this.data.recording) return;
    this.setData({ busy: true, error: '' });
    try {
      // Request authorization on every view; never reuse an old signed URL or accept a caller-supplied cloud file ID.
      const result = await this.engine.transport('getHomeworkAttachment', { ...scope, attachmentId: file.id });
      if (!this.active || !this.current()) return;
      const path = await writePreview(file.id, result.mime, result.base64); this.previews[file.id] = path;
      if (!this.active || !this.current()) { removePreview(path); return; }
      if (result.mime === 'audio/mpeg') this.play(path, file.id); else wx.previewImage({ current: path, urls: [path] });
    } catch (error) { if (this.active) this.setData({ error: errorDetails(error).message || '附件读取失败' }); }
    finally { this.setData({ busy: false }); }
  },
  previewDraft(event) {
    const file = this.files.find((item) => item.id === event.currentTarget.dataset.id); if (!file || this.data.recording) return;
    if (file.mime === 'audio/mpeg') this.play(file.path, file.id); else wx.previewImage({ current: file.path, urls: [file.path] });
  },
  play(path, id) {
    const stopping = this.data.playingId === id; this.audio?.destroy(); this.audio = undefined;
    this.setData({ playingId: '' }); if (stopping) return;
    this.audio = wx.createInnerAudioContext(); this.audio.src = path;
    this.audio.onEnded(() => { if (this.active) this.setData({ playingId: '' }); });
    this.audio.onError(() => { if (this.active) this.setData({ playingId: '', error: '录音播放失败，请重试' }); });
    this.setData({ playingId: id }); this.audio.play();
  },
  stopMedia() { this.recording?.cancel(); this.recording = undefined; this.audio?.destroy(); this.audio = undefined; },
  async consent() {
    await privacyConsent(() => new Promise<void>((resolve, reject) => {
      if (!this.active || !this.current()) { reject(new Error('请重新打开作业页')); return; }
      this.privacyResolve = (accepted) => {
        this.privacyResolve = undefined; this.setData({ privacyRequired: false });
        if (accepted) resolve(); else reject(new Error('同意隐私保护指引后才能提交录音或照片'));
      };
      this.setData({ privacyRequired: true });
    }));
  },
  agreePrivacy() { this.privacyResolve?.(true); },
  declinePrivacy() { this.privacyResolve?.(false); },
  openPrivacy() {
    this.viewingPrivacy = true;
    wx.openPrivacyContract({ fail: () => { this.setData({ error: '隐私指引暂时打不开，请检查网络' }); }, complete: () => { this.viewingPrivacy = false; } });
  },
  openToday() { wx.switchTab({ url: '/pages/today/index' }); }
};
Page(definition);
