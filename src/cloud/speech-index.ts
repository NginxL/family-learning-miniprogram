import cloud = require('wx-server-sdk');
import { createCloudStore } from './store';
import { createSpeechService } from './speech';
import { speechProvider } from './speech-provider';
import { hash, requireValue } from './validation';
import type { ApiEnvelope } from '../shared/api';

// Dedicated preview endpoint: existing familyApi and the 1.3.0 audit package are untouched.
(cloud.init as (options: { env: string | symbol }) => void)({ env: cloud.DYNAMIC_CURRENT_ENV });
const options: NonNullable<Parameters<typeof cloud.database>[0]> & { throwOnNotFound: boolean } = { throwOnNotFound: false };
const speak = createSpeechService(createCloudStore(cloud.database(options)), speechProvider(), {
  async upload(path, data) { return (await cloud.uploadFile({ cloudPath: path, fileContent: data })).fileID; },
  async download(fileId) { return (await cloud.downloadFile({ fileID: fileId })).fileContent; }
}, process.env.SPEECH_LIBRARY_ENABLED === 'true');
export async function main(event: unknown): Promise<ApiEnvelope> {
  try {
    requireValue(process.env.SPEECH_STORAGE_INCLUDED_ONLY === 'true', 'SPEECH_UNAVAILABLE', '音频保存服务尚未启用');
    const { OPENID } = cloud.getWXContext();
    requireValue(typeof OPENID === 'string' && OPENID.length > 0, 'UNAUTHENTICATED', '请通过微信小程序进入');
    const request = event as { action?: unknown; payload?: unknown } | null;
    requireValue(request?.action === 'getSpeech', 'INVALID', '此接口仅用于学习朗读');
    requireValue(request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload), 'INVALID', '请求内容无效');
    return { ok: true, data: await speak(hash(OPENID), request.payload as Record<string, unknown>, Date.now()) };
  } catch (error) {
    const detail = error as { isDomainError?: boolean; code?: string; message?: string };
    if (detail.isDomainError && detail.code && detail.message) return { ok: false, error: { code: detail.code, message: detail.message } };
    console.error('speech cache failed', { code: detail.code || 'UNKNOWN' });
    return { ok: false, error: { code: 'SPEECH_UNAVAILABLE', message: '朗读暂时不可用，请稍后重试' } };
  }
}
