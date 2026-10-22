import crypto = require('node:crypto');
import { tts } from 'tencentcloud-sdk-nodejs-tts';
import { DomainError } from './validation';
import type { SpeechProvider } from './speech';
// Credentials stay in the function runtime. Never send them to the mini program.
export function speechProvider(env: NodeJS.ProcessEnv = process.env): SpeechProvider | undefined {
  const expiresAt = Date.parse(env.TTS_FREE_EXPIRES_AT || '');
  if (env.TTS_FREE_ONLY !== 'true' || !Number.isFinite(expiresAt)) return undefined;
  return { expiresAt, async synthesize(text, language) {
    const secretId = env.TTS_SECRET_ID || env.TENCENTCLOUD_SECRETID;
    const secretKey = env.TTS_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY;
    if (!secretId || !secretKey) throw new DomainError('SPEECH_UNAVAILABLE', '朗读服务权限尚未配置');
    const client = new tts.v20190823.Client({ credential: { secretId, secretKey,
      ...(!env.TTS_SECRET_ID && env.TENCENTCLOUD_SESSIONTOKEN ? {token:env.TENCENTCLOUD_SESSIONTOKEN} : {}) },
      region: 'ap-shanghai', profile: { httpProfile: { endpoint: 'tts.tencentcloudapi.com', reqTimeout: 12 } } });
    try {
      const result = await client.TextToVoice({ Text: text, SessionId: crypto.randomUUID(), VoiceType: language === 'en' ? 101050 : 101001,
        PrimaryLanguage: language === 'en' ? 2 : 1, SampleRate: 16000, Codec: 'mp3', Speed: 0 });
      if (!result.Audio) throw new Error('Empty synthesis response');
      return result.Audio;
    } catch (cause) {
      const code = String((cause as {code?:string})?.code || '');
      console.error('speech synthesis failed', {code});
      if (/ResourceInsufficient|NoFreeAccount|Arrears|ResourceUnavailable|ResourceNotFound/.test(code))
        throw new DomainError('SPEECH_LIMIT', '免费朗读额度不可用，已停止合成，不会转为付费');
      if (/AuthFailure|Unauthorized/.test(code)) throw new DomainError('SPEECH_UNAVAILABLE', '朗读服务权限待配置，请稍后再试');
      throw new DomainError('SPEECH_UNAVAILABLE', '朗读暂时不可用，请稍后重试');
    }
  } };
}
