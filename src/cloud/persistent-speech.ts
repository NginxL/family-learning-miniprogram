import crypto = require('node:crypto');
import type { Store, Transaction, DatabaseDocuments } from '../shared/models';
import type { MediaStore } from './homework';
import type { SpeechProvider } from './speech';
import type { SpeechLanguage } from './learning/narration';
import { hash, requireValue, chinaDate } from './validation';

export const SPEECH_FILE_LIMIT = 512 * 1024;
export const SPEECH_STORAGE_LIMIT = 128 * 1024 * 1024;
export const SPEECH_TRANSFER_LIMIT = 128 * 1024 * 1024;
const LEASE_MS = 180000;

export function createPersistentSpeechCache(store: Store, media: MediaStore, provider: SpeechProvider | undefined,
  limits: { total: number; daily: number }) {
  const inFlight = new Map<string, Promise<{ base64: string; digest: string }>>();
  const validate = (base64: string) => {
    const bytes = Buffer.from(base64, 'base64');
    requireValue(bytes.length > 0 && bytes.length <= SPEECH_FILE_LIMIT && bytes.toString('base64') === base64
      && (bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)),
      'SPEECH_UNAVAILABLE', '朗读音频校验失败，请重试');
    return bytes;
  };
  async function reserveTransfer(bytes: number, now: number) {
    await store.run(async tx => {
      const id = `speech-transfer-v1:${chinaDate(now)}`;
      const usage = await tx.get('speechUsage', id) || { characters: 0, bytes: 0 };
      requireValue((usage.bytes || 0) + bytes <= SPEECH_TRANSFER_LIMIT, 'SPEECH_LIMIT', '今日音频下载已达保护上限，手机已保存的音频仍可播放');
      await tx.put('speechUsage', id, { ...usage, bytes: (usage.bytes || 0) + bytes });
    });
  }
  async function generate(key: string, familyId: string, text: string, language: SpeechLanguage, now: number,
    authorize: (tx: Transaction) => Promise<void>) {
    const owner = crypto.randomUUID();
    const record = await store.run(async tx => {
      await authorize(tx);
      const old = await tx.get('speechAudio', key);
      if (old?.state === 'ready') return old;
      requireValue(!old || old.leaseUntil <= now, 'SPEECH_PENDING', '音频正在准备，请稍后再试');
      // Upload retries reuse staged audio even if the free synthesis window has ended.
      if (!old?.base64) {
        requireValue(provider && Number.isFinite(provider.expiresAt) && now < provider.expiresAt, 'SPEECH_UNAVAILABLE', '免费合成尚未启用或已到期，已保存的音频仍可播放');
        const totalId = 'speech-v1', dailyId = hash(`${familyId}:${chinaDate(now)}`);
        const total = await tx.get('speechUsage', totalId) || { characters: 0 };
        const daily = await tx.get('speechUsage', dailyId) || { characters: 0 };
        const amount = Array.from(text).length;
        requireValue(total.characters + amount <= limits.total && daily.characters + amount <= limits.daily,
          'SPEECH_LIMIT', '免费合成额度已达保护上限，已保存的音频仍可播放');
        await tx.put('speechUsage', totalId, { ...total, characters: total.characters + amount });
        await tx.put('speechUsage', dailyId, { ...daily, characters: daily.characters + amount });
      }
      if (!old) {
        const used = await tx.get('speechUsage', 'speech-storage-v1') || { characters: 0, bytes: 0 };
        requireValue((used.bytes || 0) + SPEECH_FILE_LIMIT <= SPEECH_STORAGE_LIMIT, 'SPEECH_LIMIT', '音频保存空间已达保护上限，已保存的音频仍可播放');
        await tx.put('speechUsage', 'speech-storage-v1', { ...used, bytes: (used.bytes || 0) + SPEECH_FILE_LIMIT });
      }
      const next: DatabaseDocuments['speechAudio'] = { ...(old || { createdAt: now, reservedBytes: SPEECH_FILE_LIMIT }), state: 'pending', owner, leaseUntil: now + LEASE_MS };
      await tx.put('speechAudio', key, next);
      return next;
    });
    if (record.state === 'ready') {
      requireValue(record.fileId && record.digest && record.bytes && record.bytes <= SPEECH_FILE_LIMIT,
        'SPEECH_UNAVAILABLE', '已保存的音频暂时不可用，请稍后重试');
      await reserveTransfer(record.bytes, now);
      // A missing/corrupt cloud object is not a reason to silently spend synthesis quota again.
      const bytes = await media.download(record.fileId);
      const base64 = bytes.toString('base64'); validate(base64);
      requireValue(bytes.length === record.bytes && hash(base64) === record.digest, 'SPEECH_UNAVAILABLE', '已保存的音频校验失败，请联系管理员');
      return { base64, digest: record.digest };
    }
    try {
      let base64 = record.base64;
      if (!base64) {
        base64 = await provider!.synthesize(text, language); const bytes = validate(base64);
        await store.run(async tx => {
          const current = await tx.get('speechAudio', key);
          requireValue(current?.owner === owner && current.state === 'pending', 'SPEECH_PENDING', '音频正在准备，请稍后再试');
          await tx.put('speechAudio', key, { ...current, base64, bytes: bytes.length, digest: hash(base64!) });
        });
      }
      const bytes = validate(base64); const digest = hash(base64);
      // Unique upload path prevents an expired worker overwriting another worker's completed audio.
      const fileId = await media.upload(`speech/v1/${familyId}/${key}/${owner}.mp3`, bytes);
      await store.run(async tx => {
        const current = await tx.get('speechAudio', key);
        requireValue(current?.owner === owner && current.state === 'pending', 'SPEECH_PENDING', '音频正在准备，请稍后再试');
        const usage = await tx.get('speechUsage', 'speech-storage-v1');
        requireValue(usage && (usage.bytes || 0) >= current.reservedBytes, 'SPEECH_UNAVAILABLE', '音频保存记录暂时不可用');
        await tx.put('speechUsage', 'speech-storage-v1', { ...usage, bytes: usage.bytes! - current.reservedBytes + bytes.length });
        await tx.put('speechAudio', key, { state: 'ready', owner, leaseUntil: 0, reservedBytes: bytes.length,
          createdAt: current.createdAt, fileId, bytes: bytes.length, digest });
      });
      await reserveTransfer(bytes.length, now);
      return { base64, digest };
    } catch (error) {
      // Do not refund uncertain synthesis requests. Keep staged audio for upload-only retries.
      await store.run(async tx => {
        const current = await tx.get('speechAudio', key);
        if (current?.owner === owner && current.state === 'pending') await tx.put('speechAudio', key, { ...current, leaseUntil: 0 });
      }).catch(() => {});
      throw error;
    }
  }
  return async (key: string, familyId: string, text: string, language: SpeechLanguage, now: number,
    authorize: (tx: Transaction) => Promise<void>) => {
    let work = inFlight.get(key);
    if (!work) { work = generate(key, familyId, text, language, now, authorize); inFlight.set(key, work); }
    try { const result = await work; await store.run(authorize); return result; }
    finally { if (inFlight.get(key) === work) inFlight.delete(key); }
  };
}
