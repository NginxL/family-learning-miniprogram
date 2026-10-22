import type { Store, ContentInput } from '../shared/models';
import type { ApiResults } from '../shared/api';
import { narration, type SpeechLanguage } from './learning/narration';
import * as learning from './learning/learning';
import { hash, identifier, requireValue, chinaDate } from './validation';
export interface SpeechProvider {
  expiresAt: number;
  synthesize(text: string, language: SpeechLanguage): Promise<string>;
}
// A conservative app budget, below the claimed 8M free characters. Provider-side
// postpaid must be off as well. Reservations are never refunded after uncertain calls.
export const SPEECH_BUDGET = 1000000;
export const SPEECH_DAILY_BUDGET = 10000;
export function createSpeechService(store: Store, provider?: SpeechProvider) {
  const cache = new Map<string, { base64: string; at: number }>();
  const inFlight = new Map<string, Promise<string>>();
  return async (uid: string, input: Record<string, unknown>, now: number): Promise<ApiResults['getSpeech']> => {
    const familyId = identifier(input.familyId); const childId = identifier(input.childId); const contentId = identifier(input.contentId);
    requireValue(Number.isInteger(input.part) && Number(input.part) >= 0, 'INVALID', '朗读段落无效');
    requireValue(provider && Number.isFinite(provider.expiresAt) && now < provider.expiresAt, 'SPEECH_UNAVAILABLE', '免费朗读尚未启用或已到期，学习和打卡仍可使用');
    const plan = await store.run(async tx => {
      const profile = await tx.get('profiles', uid);
      const family = profile?.familyId === familyId ? await tx.get('families', familyId) : null;
      const member = family?.members.find(item => item.id === uid);
      requireValue(family && member, 'FORBIDDEN', '当前账号没有这个家庭的访问权限');
      requireValue(family.children.some(item => item.id === childId) && (member.role !== 'child' || member.childId === childId), 'FORBIDDEN', '请使用自己绑定的学习档案');
      let item: ContentInput | undefined = learning.catalogById.get(contentId);
      if (!item && input.taskId !== undefined) {
        identifier(input.taskId);
        requireValue(typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date), 'INVALID', '任务日期无效');
        const day = await tx.get('days', hash(`${familyId}:${input.date}`));
        item = day?.tasks.find(task => task.id === input.taskId && task.childId === childId && learning.contentId(task) === contentId);
      }
      if (!item) item = family.plans.find(plan => plan.childId === childId && learning.contentId(plan) === contentId);
      if (!item) {
        const ledger = await tx.get('learning', hash(`${familyId}:${childId}`));
        const record = ledger?.records[contentId]; if (record) item = learning.content(record.item);
      }
      requireValue(item, 'NOT_FOUND', '学习内容已变化，请返回列表刷新');
      const plan = narration(item); const text = plan.chunks[Number(input.part)];
      requireValue(text, 'INVALID', '此内容暂没有可朗读的正文');
      return { text, language: plan.language, parts: plan.chunks.length };
    });
    // Private custom text never shares a cache namespace across households.
    const key = hash(JSON.stringify([familyId, plan.language, plan.text, 'premium-v1']));
    const recent = cache.get(key);
    const cached = recent && now - recent.at < 15 * 60000 ? recent.base64 : undefined;
    let work = cached ? Promise.resolve(cached) : inFlight.get(key);
    if (!work) {
      work = (async () => {
        await store.run(async tx => {
          const totalId = 'speech-v1'; const dailyId = hash(`${familyId}:${chinaDate(now)}`);
          const total = await tx.get('speechUsage', totalId) || { characters: 0 };
          const daily = await tx.get('speechUsage', dailyId) || { characters: 0 };
          const amount = Array.from(plan.text).length;
          requireValue(total.characters + amount <= SPEECH_BUDGET, 'SPEECH_LIMIT', '本期免费朗读额度已用完，学习和打卡仍可使用');
          requireValue(daily.characters + amount <= SPEECH_DAILY_BUDGET, 'SPEECH_LIMIT', '今日朗读次数较多，请明天再试');
          await tx.put('speechUsage', totalId, { characters: total.characters + amount });
          await tx.put('speechUsage', dailyId, { characters: daily.characters + amount });
          return true;
        });
        const base64 = await provider.synthesize(plan.text, plan.language);
        requireValue(typeof base64 === 'string' && base64.length > 0 && base64.length <= 700000 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64), 'SPEECH_UNAVAILABLE', '语音生成未完成，请重试');
        cache.set(key, {base64, at: now}); while (cache.size > 24) cache.delete(cache.keys().next().value!);
        return base64;
      })();
      inFlight.set(key, work);
    }
    try { return { base64: await work, mime: 'audio/mpeg', part: Number(input.part), parts: plan.parts, key }; }
    finally { if (inFlight.get(key) === work) inFlight.delete(key); }
  };
}
