import { narration } from '../../lib/learning/narration';
import { playSpeech, type SpeechState } from '../../lib/speech-player';
import type { LearningApp } from '../../lib/client-models';
import type { ContentInput } from '../../../shared/models';
import { isSpeechAccent, type SpeechAccent } from '../../lib/learning/speech-profile';
const accents: SpeechAccent[] = ['default', 'en-GB', 'en-US'];
const runtimes=new WeakMap<object,{token:number;context?:string;handle?:{stop():void}}>();
function runtime(owner:object){let value=runtimes.get(owner);if(!value){value={token:0};runtimes.set(owner,value);}return value;}
Component({
  options: {styleIsolation:'isolated'},
  properties: {item:{type:Object,value:null},childId:{type:String,value:''},date:{type:String,value:''},taskId:{type:String,value:''}},
  data: {available:false,english:false,accent:'default' as SpeechAccent,accentIndex:0,accentLabels:['通用朗读','英式发音','美式发音'],loading:false,playing:false,part:0,parts:0,error:'',notice:'',confirming:false},
  observers: {'item,childId,date,taskId':function(item:ContentInput|null,childId:string,date:string,taskId:string) {
    const state=runtime(this);const context=JSON.stringify([item?.id,item?.title,item?.detail,childId,date,taskId]);
    // Background sync refreshes the item object every 20 seconds. It must not
    // interrupt a long reading unless the actual text or child changes.
    if(state.context!==context){this.stopReading();state.context=context;this.setData({loading:false,playing:false,error:''});}
    const plan=item&&narration(item);
    this.setData({available:Boolean(plan?.chunks.length),english:plan?.language==='en'});
  }},
  lifetimes: {
    attached() { try { const accent=wx.getStorageSync('speech-accent-v1'); if(isSpeechAccent(accent))this.setData({accent,accentIndex:accents.indexOf(accent)}); } catch { /* The default also works when preference storage is full. */ } },
    detached() {this.stopReading();}
  },
  pageLifetimes: {hide() {this.stopReading();}},
  methods: {
    stopReading() { const state=runtime(this);state.handle?.stop();state.handle=undefined;state.token++; },
    selectAccent(event:WechatMiniprogram.PickerChange) {
      const index=Number(event.detail.value),accent=accents[index];
      if(!Number.isInteger(index)||!accent||this.data.confirming)return;
      this.stopReading();this.setData({accent,accentIndex:index,loading:false,playing:false,error:'',notice:''});
      try { wx.setStorageSync('speech-accent-v1',accent); } catch { /* Playback does not require saving preferences. */ }
    },
    async toggleReading() {
      if(this.data.loading||this.data.playing){this.stopReading();return;}
      if(this.data.confirming)return;
      const app=getApp<LearningApp>();
      if(app.mode==='demo'){this.setData({error:'朗读需要连接云端，请使用云端版本'});return;}
      const state=runtime(this); const token=++state.token;
      const scope=JSON.stringify([app.engine.state.userId,app.engine.state.family?.id,this.data.childId]);
      const consentKey='speech-text-consent-v2';
      if(!wx.getStorageSync(consentKey)) {
        this.setData({confirming:true});
        try {
          const accepted=await new Promise<boolean>((resolve,reject)=>wx.showModal({title:'开启学习朗读',content:'点击播放会自动保存音频供以后复用。首次合成仅将所选学习文字发送至腾讯云，不发送档案或作业；公开学习内容也可播放已核对的预生成音频；音频保存在本机和受权限保护的云存储。多音字请结合教材核对。',confirmText:'同意播放',success:r=>resolve(r.confirm),fail:reject}));
          if(!accepted||state.token!==token)return;
          wx.setStorageSync(consentKey,true);
        } catch {this.setData({error:'朗读确认未打开，请重试'});return;}
        finally {this.setData({confirming:false});}
      }
      if(state.token!==token||scope!==JSON.stringify([app.engine.state.userId,app.engine.state.family?.id,this.data.childId]))return;
      state.handle=playSpeech(app.engine,this.data.item as ContentInput,this.data.childId,this.data.date||undefined,this.data.taskId||undefined,
        (value:SpeechState)=>{if(state.token===token)this.setData(value);},this.data.english?this.data.accent:'default');
    }
  }
});
