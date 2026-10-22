import type { ApiPayloads, ApiResults } from '../../shared/api';
import { narration } from './learning/narration';
import { contentId } from './learning/learning';
import type { ContentInput } from '../../shared/models';
import type { SyncEngine } from './sync-engine';
export interface SpeechState { loading: boolean; playing: boolean; part: number; parts: number; error: string }
const idle = (): SpeechState => ({loading:false,playing:false,part:0,parts:0,error:''});
let current: { stop(): void } | undefined;
// Memory-only audio cache is scoped by authenticated identity; no private text in URLs or persistent storage.
const cache = new Map<string, ApiResults['getSpeech']>();
let cacheBytes = 0;
export function stopSpeech() { current?.stop(); }
export function playSpeech(engine: SyncEngine, item: ContentInput, childId: string, date: string | undefined,
  taskId: string | undefined, update: (value: SpeechState) => void) {
  current?.stop();
  const snapshot = engine.snapshot(); const family = snapshot.family;
  const sessionKey = () => JSON.stringify([engine.state.userId,engine.state.family?.id,engine.state.family?.myRole,engine.state.family?.myChildId]);
  const originalSession = sessionKey();
  let stopped=false, audio:WechatMiniprogram.InnerAudioContext|undefined, path='';
  let cancelPlayback: (()=>void)|undefined;
  const erase = () => { if(path){wx.getFileSystemManager().unlink({filePath:path,fail(){}});path='';} };
  const stop = () => { if(stopped)return;stopped=true;cancelPlayback?.(); audio?.destroy();audio=undefined;erase();update(idle());if(current===control)current=undefined;unsubscribe?.(); };
  const control = {stop}; current=control;
  const unsubscribe = engine.subscribe(()=>{if(sessionKey()!==originalSession){stop();cache.clear();cacheBytes=0;}});
  const state = (value: SpeechState) => { if (!stopped) update(value); };
  const run = async () => {
    if (!family || !snapshot.userId || !family.children.some(child=>child.id===childId)) throw new Error('请先连接孩子的学习档案');
    const plan = narration(item); if(!plan.chunks.length)throw new Error('此内容暂没有可朗读的正文');
    const sourceKey = JSON.stringify([originalSession,item.title,item.detail,childId,date,taskId]);
    let parts=plan.chunks.length;
    for(let part=0;part<parts&&!stopped;part++) {
      state({loading:true,playing:false,part:part+1,parts,error:''});
      const key=JSON.stringify([sourceKey,part]);
      let result=cache.get(key);
      if(!result) {
        const request:ApiPayloads['getSpeech']={familyId:family.id,childId,contentId:contentId(item),part,...(date&&taskId?{date,taskId}:{})};
        result=await engine.transport('getSpeech',request);
        if(stopped||sessionKey()!==originalSession)return;
        while(cache.size&&cacheBytes+result.base64.length>4*1024*1024){const oldest=cache.keys().next().value!;cacheBytes-=cache.get(oldest)!.base64.length;cache.delete(oldest);}
        cache.set(key,result);cacheBytes+=result.base64.length;
      }
      parts=result.parts;
      path=`${wx.env.USER_DATA_PATH}/speech-${Date.now()}-${part}-${Math.random().toString(36).slice(2)}.mp3`;
      const filePath=path;
      await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:result.base64,encoding:'base64',success:()=>resolve(),fail:()=>reject(new Error('本机空间不足，暂时无法播放'))}));
      if(stopped){wx.getFileSystemManager().unlink({filePath,fail(){}});return;}
      audio=wx.createInnerAudioContext(); audio.obeyMuteSwitch=false;
      state({loading:false,playing:true,part:part+1,parts,error:''});
      await new Promise<void>((resolve,reject)=>{
        cancelPlayback=resolve;
        audio!.onEnded(()=>resolve());audio!.onError(()=>reject(new Error('播放失败，请检查网络或音量后重试')));
        audio!.onStop?.(()=>stop());
        audio!.src=filePath;audio!.play();
      });
      audio?.destroy();audio=undefined;erase();
    }
    stop();
  };
  void run().catch(cause=>{if(stopped)return;stop();update({...idle(),error:cause instanceof Error?cause.message:'朗读失败，请重试'});});
  return control;
}
