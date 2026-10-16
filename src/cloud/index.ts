import cloud = require('wx-server-sdk');
import { createService } from './service';
import { createCloudStore } from './store';
import type { ApiEnvelope } from '../shared/api';

// DYNAMIC_CURRENT_ENV is a supported runtime symbol missing from the SDK init declaration.
const init = cloud.init as (options: { env: string | symbol }) => void;
init({ env: cloud.DYNAMIC_CURRENT_ENV });
// The installed SDK accepts this option; its bundled declaration omits it.
// tests/sdk-contract.test.js exercises the installed SDK's actual transaction contract.
const databaseOptions: NonNullable<Parameters<typeof cloud.database>[0]> & { throwOnNotFound: boolean } = { throwOnNotFound: false };
const service = createService({ store: createCloudStore(cloud.database(databaseOptions)), media: {
  async upload(path, data) { return (await cloud.uploadFile({ cloudPath: path, fileContent: data })).fileID; },
  async download(fileId) { return (await cloud.downloadFile({ fileID: fileId })).fileContent; }
} });

export async function main(event: unknown): Promise<ApiEnvelope> {
  try {
    // Never accept identity or private household defaults from the caller.
    const { OPENID } = cloud.getWXContext();
    const request = event as { action?: unknown; payload?: unknown } | null | undefined;
    const data = await service.executeRaw(OPENID, request && request.action, request && request.payload);
    return { ok: true, data };
  } catch (error) {
    const detail = error as { code?: unknown; errCode?: unknown; isDomainError?: unknown; message?: unknown } | null;
    if (detail && typeof detail.code === 'string' && detail.isDomainError === true && typeof detail.message === 'string') {
      return { ok: false, error: { code: detail.code, message: detail.message } };
    }
    console.error('familyApi failed', { code: detail && (detail.errCode || detail.code) || 'UNKNOWN' });
    return { ok: false, error: { code: 'UNAVAILABLE', message: '服务暂时不可用，请稍后重试' } };
  }
}
