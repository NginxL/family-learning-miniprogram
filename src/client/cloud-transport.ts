import type { ApiAction, ApiPayloads, ApiResults, ApiTransport } from '../shared/api';

export interface WechatCloud {
  callFunction(input: { name: string; data: { action: ApiAction; payload: unknown } }): Promise<{ result?: unknown }>;
}
export class ApiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createCloudTransport(cloud: WechatCloud | undefined, envId: string, speechFunction?: string): ApiTransport {
  return async <A extends ApiAction>(action: A, payload: ApiPayloads[A]): Promise<ApiResults[A]> => {
    if (!cloud || !envId) throw new Error('云开发尚未配置，请设置环境 ID');
    const response = await cloud.callFunction({ name: action === 'getSpeech' && speechFunction ? speechFunction : 'familyApi', data: { action, payload } });
    const result = response.result;
    if (!isRecord(result) || result.ok !== true || !('data' in result)) {
      const detail = isRecord(result) && isRecord(result.error) ? result.error : null;
      throw new ApiError(detail && typeof detail.message === 'string' ? detail.message : '云函数返回异常',
        detail && typeof detail.code === 'string' ? detail.code : undefined);
    }
    // The envelope is checked above. Action-specific bodies come from our typed service;
    // static types do not replace its runtime payload validation or authorization.
    return result.data as ApiResults[A];
  };
}
