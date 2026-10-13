import type { ClientTransport } from './client-models';
// The demo implementation remains JS; it is covered by the shared page/native-loader tests.
export function createDemo(wx: Pick<WechatMiniprogram.Wx, 'getStorageSync' | 'setStorageSync'>): ClientTransport;
