import type { HomeworkAttachment } from '../../shared/models';
import { stopSpeech } from './speech-player';
export interface DraftAttachment { id: string; path: string; mime: HomeworkAttachment['mime']; duration: number; attachmentId?: string }
export const draftId = () => `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
export async function privacyConsent(present: () => Promise<void>): Promise<void> {
  const needsAuthorization = await new Promise<boolean>((resolve, reject) => {
    if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) { reject(new Error('请更新微信后再提交录音或照片')); return; }
    wx.getPrivacySetting({ success: (result) => resolve(result.needAuthorization), fail: () => reject(new Error('无法获取隐私设置，请联网后重试')) });
  });
  // The native agreePrivacyAuthorization button records consent before this resumes.
  if (needsAuthorization) await present();
  return new Promise((resolve, reject) => {
    wx.requirePrivacyAuthorize({ success: () => resolve(), fail: () => reject(new Error('同意隐私保护指引后才能提交录音或照片')) });
  });
}
export function readBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64',
    success: (result) => {
      if (typeof result.data !== 'string' || result.data.length > 699052) reject(new Error('附件超过512KB，请重新拍摄或缩短录音'));
      else resolve(result.data);
    }, fail: () => reject(new Error('附件已失效，请重新拍摄或录音')) }));
}
export async function choosePhotos(count: number): Promise<DraftAttachment[]> {
  const files = await new Promise<WechatMiniprogram.MediaFile[]>((resolve, reject) => wx.chooseMedia({ count, mediaType: ['image'],
    sourceType: ['camera', 'album'], sizeType: ['compressed'], success: (result) => resolve(result.tempFiles),
    fail: (error) => reject(new Error(error.errMsg.includes('cancel') ? '已取消选择照片' : '无法打开相机或相册，请检查微信权限')) }));
  const result: DraftAttachment[] = [];
  for (const file of files) {
    const path = await new Promise<string>((resolve, reject) => wx.compressImage({ src: file.tempFilePath, quality: 50, compressedWidth: 1000,
      success: (value) => resolve(value.tempFilePath), fail: () => reject(new Error('照片压缩失败，请重新拍摄')) }));
    const data = await readBase64(path);
    const mime = data.startsWith('/9j/') ? 'image/jpeg' : data.startsWith('iVBORw0KGgo') ? 'image/png' : null;
    if (!mime) throw new Error('请选择JPG、PNG照片，或使用拍照提交');
    result.push({ id: draftId(), path, mime, duration: 0 });
  }
  return result;
}
export function writePreview(id: string, mime: HomeworkAttachment['mime'], base64: string): Promise<string> {
  const path = `${wx.env.USER_DATA_PATH}/homework-${id}.${mime === 'audio/mpeg' ? 'mp3' : mime === 'image/png' ? 'png' : 'jpg'}`;
  return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: base64, encoding: 'base64',
    success: () => resolve(path), fail: () => reject(new Error('本机空间不足，无法查看附件')) }));
}
export function removePreview(path: string) { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); }

export interface Recording { stop(): void; cancel(): void }
// WeChat exposes one recorder, with no offStop/offError APIs. Register listeners once;
// keep the old session until its stop event arrives so it cannot leak into the next page.
let recorder: WechatMiniprogram.RecorderManager | undefined;
let session: { done: WechatMiniprogram.RecorderManagerOnStopCallback; fail: () => void; cancelled: boolean } | undefined;
export function startRecording(done: WechatMiniprogram.RecorderManagerOnStopCallback, fail: () => void): Recording {
  if (session) throw new Error('上一段录音正在结束，请稍后重试');
  stopSpeech();
  if (!recorder) {
    recorder = wx.getRecorderManager();
    recorder.onStop((result) => { const previous = session; session = undefined; if (previous && !previous.cancelled) previous.done(result); });
    recorder.onError(() => { const previous = session; session = undefined; if (previous && !previous.cancelled) previous.fail(); });
    recorder.onInterruptionBegin(() => recorder?.stop());
  }
  const current = { done, fail, cancelled: false }; session = current;
  try { recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 32000, format: 'mp3' }); }
  catch (error) { session = undefined; throw error; }
  return {
    stop() { if (session === current) recorder?.stop(); },
    cancel() { if (session === current) { current.cancelled = true; recorder?.stop(); } }
  };
}
