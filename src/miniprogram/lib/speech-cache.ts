import { speechContentKey, speechHash } from './learning/speech-profile';
import type { ApiResults } from '../../shared/api';

const LIMIT = 128 * 1024 * 1024;
const MAX_FILE = 512 * 1024;
const directory = () => `${wx.env.USER_DATA_PATH}/speech-audio-v2`;
const nameFor = (scope: string, text: string, voice: string) => `${speechHash(scope)}-${speechContentKey(text, voice)}`;
type Meta = { digest: string; bytes: number };
function remove(filePath: string) { try { wx.getFileSystemManager().unlinkSync(filePath); } catch { /* Already absent. */ } }

export function readSavedSpeech(scope: string, text: string, voice: string): string | undefined {
  const name = nameFor(scope, text, voice), path = `${directory()}/${name}.mp3`, metaPath = `${directory()}/${name}.json`;
  const fs = wx.getFileSystemManager();
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') as string) as Meta;
    if (!meta || !/^[a-f0-9]{64}$/.test(meta.digest) || !Number.isInteger(meta.bytes) || meta.bytes <= 0 || meta.bytes > MAX_FILE) throw Error('Invalid metadata');
    const stat = fs.statSync(path) as WechatMiniprogram.Stats;
    if (stat.size !== meta.bytes || !stat.isFile()) throw Error('Invalid file');
    if (speechHash(fs.readFileSync(path, 'base64') as string) !== meta.digest) throw Error('Invalid audio digest');
    return path;
  } catch {
    // Only damaged entries are removed. No age-based expiry or LRU eviction of saved audio.
    remove(metaPath); remove(path); return undefined;
  }
}

export function saveSpeech(scope: string, text: string, voice: string, result: ApiResults['getSpeech']): string | undefined {
  // Old backends remain playable, but cannot certify a persistent text/voice identity.
  if (!result.persistent || result.textHash !== speechHash(text) || result.voiceKey !== voice
    || !result.digest || speechHash(result.base64) !== result.digest) return undefined;
  const bytes = Math.floor(result.base64.length / 4) * 3 - (result.base64.endsWith('==') ? 2 : result.base64.endsWith('=') ? 1 : 0);
  if (bytes <= 0 || bytes > MAX_FILE) return undefined;
  const fs = wx.getFileSystemManager(), dir = directory(), name = nameFor(scope, text, voice);
  const path = `${dir}/${name}.mp3`, staging = `${path}.part`, metaPath = `${dir}/${name}.json`;
  try {
    try { fs.mkdirSync(dir, true); } catch { /* The directory normally already exists. */ }
    let total = 0;
    for (const file of fs.readdirSync(dir)) {
      if (/^[a-f0-9]{64}-[a-f0-9]{64}\.mp3$/.test(file)) total += (fs.statSync(`${dir}/${file}`) as WechatMiniprogram.Stats).size;
    }
    if (total + bytes > LIMIT) throw Error('Local speech cache capacity reached');
    fs.writeFileSync(staging, result.base64, 'base64');
    fs.renameSync(staging, path);
    fs.writeFileSync(metaPath, JSON.stringify({ digest: result.digest, bytes }), 'utf8');
    return path;
  } catch {
    remove(staging); remove(metaPath); remove(path);
    return undefined;
  }
}
