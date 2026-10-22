const test=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('./helpers');const learning=require('../shared/learning');const {narration}=require('../shared/narration');
const audio=Buffer.from('ID3-test-audio').toString('base64');
function setup(options={}) {let calls=[];const f=fixture({speech:{expiresAt:Date.parse('2027-01-01'),synthesize:async(text,language)=>{calls.push({text,language});return audio;}},...options});return {f,calls};}
test('narration reads words and sentences, article body and poems without Chinese glosses, provenance or self-test answers',()=>{
 assert.deepEqual(narration(learning.catalogById.get('word-hello')),{language:'en',chunks:['hello']});
 assert.equal(narration(learning.catalogById.get('sentence-morning')).chunks[0],'Good morning!');
 const article=narration(learning.catalogById.get('english-reading-red-bag'));assert.equal(article.language,'en');assert.doesNotMatch(article.chunks.join(' '),/Read and think|包|What colour/);
 const poem=narration(learning.catalogById.get('poem-goose'));assert.match(poem.chunks.join(''),/白毛浮绿水/);assert.doesNotMatch(poem.chunks.join(''),/来源/);
 for(const item of learning.catalog){const n=narration(item);assert.ok(n.chunks.every(c=>Array.from(c).length<=(n.language==='en'?420:120)));}
 const long='First sentence. '.repeat(180);const n=narration({id:'long',kind:'english-reading',detail:long,title:'Long'});assert.ok(n.chunks.length>1);assert.equal(n.chunks.join(' ').replace(/\s/g,''),long.replace(/\s/g,''));
});
test('speech authenticates parent/child, ignores arbitrary client text, caches repeats and never changes learning records',async()=>{
 const {f,calls}=setup();const family=await f.family();const childId=family.children[0].id;const p={familyId:family.id,childId,contentId:'word-hello',part:0};
 const before=f.inspect();const r=await f.call('parent-a','getSpeech',{...p,text:'private injected text'});assert.equal(r.base64,audio);assert.deepEqual(calls,[{text:'hello',language:'en'}]);
 await f.call('parent-a','getSpeech',p);assert.equal(calls.length,1);
 await assert.rejects(f.call('stranger','getSpeech',p),{code:'FORBIDDEN'});
 const invite=await f.call('parent-a','createInvite',{familyId:family.id,childId,role:'child',guardianConsent:true});await f.call('child','joinFamily',{code:invite.code,memberName:'孩子'});
 await f.call('child','getSpeech',p);assert.equal(calls.length,1);
 await assert.rejects(f.call('child','getSpeech',{...p,childId:'other-child'}),{code:'FORBIDDEN'});
 await assert.rejects(f.call('parent-a','getSpeech',{...p,part:999}),{code:'INVALID'});
 const after=f.inspect();for(const key of Object.keys(before).filter(k=>k.startsWith('learning/')||k.startsWith('days/')))assert.deepEqual(after[key],before[key]);
});
test('disabled/expired free-only service never calls provider; concurrent requests reserve once and errors remain charged against local budget',async()=>{
 let sent=0;const {f}=setup({speech:{expiresAt:0,synthesize:async()=>{sent++;return audio;}}});const family=await f.family();const payload={familyId:family.id,childId:family.children[0].id,contentId:'poem-goose',part:0};
 await assert.rejects(f.call('parent-a','getSpeech',payload),{code:'SPEECH_UNAVAILABLE'});assert.equal(sent,0);
 const second=setup();const fam=await second.f.family();const p={...payload,familyId:fam.id,childId:fam.children[0].id};await Promise.all(Array.from({length:5},()=>second.f.call('parent-a','getSpeech',p)));assert.equal(second.calls.length,1);
});
test('speech file playback stops on page exit and on account switch, discarding late responses',async t=>{
 const {playSpeech}=require('../miniprogram/lib/speech-player');let writes=0,plays=0,destroys=0,resolve;const listeners=new Set();
 const engine={state:{userId:'u',family:{id:'f',myRole:'owner',children:[{id:'c'}]}},snapshot(){return {...this.state};},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},transport:()=>new Promise(r=>resolve=r)};
 global.wx={env:{USER_DATA_PATH:'/tmp'},getFileSystemManager:()=>({writeFile(o){writes++;o.success();},unlink(){}}),createInnerAudioContext:()=>({onEnded(fn){this.ended=fn;},onError(){},play(){plays++;},destroy(){destroys++;}})};t.after(()=>delete global.wx);
 const states=[];const control=playSpeech(engine,learning.catalogById.get('word-hello'),'c',undefined,undefined,s=>states.push(s));control.stop();resolve({base64:audio,part:0,parts:1,key:'key'});await new Promise(r=>setImmediate(r));assert.equal(writes,0);assert.equal(plays,0);
 playSpeech(engine,learning.catalogById.get('word-hello'),'c',undefined,undefined,s=>states.push(s));resolve({base64:audio,part:0,parts:1,key:'key'});await new Promise(r=>setImmediate(r));assert.equal(plays,1);engine.state.userId='changed';listeners.forEach(fn=>fn());assert.equal(destroys,1);assert.equal(states.at(-1).playing,false);
});

test('free speech budgets reject before synthesis and uncertain failures keep their reserved characters',async()=>{
 const {createSpeechService,SPEECH_BUDGET,SPEECH_DAILY_BUDGET}=require('../cloudfunctions/familyApi/speech');
 const {hash,chinaDate}=require('../cloudfunctions/familyApi/validation');
 const now=Date.parse('2026-10-22T01:00:00Z');
 const docs=new Map([['profiles/u',{familyId:'family'}],['families/family',{children:[{id:'child'}],members:[{id:'u',role:'owner'}],plans:[]}]]);
 const store={run:async fn=>fn({get:async(c,id)=>structuredClone(docs.get(`${c}/${id}`)||null),put:async(c,id,v)=>docs.set(`${c}/${id}`,v)})};
 let sent=0;const call=createSpeechService(store,{expiresAt:now+60000,synthesize:async()=>{sent++;throw Error('uncertain network failure');}});
 const input={familyId:'family',childId:'child',contentId:'word-hello',part:0};
 docs.set('speechUsage/speech-v1',{characters:SPEECH_BUDGET});
 await assert.rejects(call('u',input,now),{code:'SPEECH_LIMIT'});assert.equal(sent,0);
 docs.set('speechUsage/speech-v1',{characters:0});const daily=`speechUsage/${hash(`family:${chinaDate(now)}`)}`;
 docs.set(daily,{characters:SPEECH_DAILY_BUDGET});
 await assert.rejects(call('u',input,now),{code:'SPEECH_LIMIT'});assert.equal(sent,0);
 docs.set(daily,{characters:0});await assert.rejects(call('u',input,now),/uncertain network failure/);
 assert.equal(sent,1);assert.equal(docs.get('speechUsage/speech-v1').characters,5);assert.equal(docs.get(daily).characters,5);
});

test('provider is explicitly free-only, uses fixed covered voices and has no paid fallback',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let config,params;const exported={};
 class Client {constructor(value){config=value;}async TextToVoice(value){params=value;return {Audio:audio};}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cloudfunctions/familyApi/speech-provider.js'),'utf8'),{exports:exported,process:{env:{}},console,require(name){
  if(name==='tencentcloud-sdk-nodejs-tts')return {tts:{v20190823:{Client}}};
  if(name==='./validation')return require('../cloudfunctions/familyApi/validation');
  if(name==='./speech-library')return require('../cloudfunctions/familyApi/speech-library');
  if(name==='./learning/speech-profile')return require('../shared/speech-profile');
  return require(name);
 }});
 const env={TTS_FREE_ONLY:'true',TTS_FREE_EXPIRES_AT:'2027-01-22T02:30:00Z',TENCENTCLOUD_SECRETID:'temporary-id',TENCENTCLOUD_SECRETKEY:'temporary-key',TENCENTCLOUD_SESSIONTOKEN:'temporary-token'};
 assert.equal(exported.speechProvider({}),undefined);assert.equal(exported.speechProvider({...env,TTS_FREE_ONLY:'false'}),undefined);
 assert.equal(exported.speechProvider({...env,TTS_FREE_EXPIRES_AT:''}),undefined);
 const provider=exported.speechProvider(env);assert.equal(await provider.synthesize('hello','en'),audio);
 assert.equal(config.credential.token,'temporary-token');assert.equal(params.VoiceType,101050);assert.equal(params.Text,'hello');assert.equal(params.Codec,'mp3');assert.equal(params.PrimaryLanguage,2);
 await provider.synthesize('你好','zh');assert.equal(params.VoiceType,101001);assert.equal(params.PrimaryLanguage,1);
 assert.equal(params.Volume,undefined);assert.equal(params.EmotionCategory,undefined);
});

test('speech component survives unchanged sync refreshes and stops on changed content or child',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let definition;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/components/speech-button/index.js'),'utf8'),{exports:{},Component:v=>definition=v,require(name){
  if(name.includes('narration'))return {narration};if(name.includes('speech-profile'))return require('../shared/speech-profile');if(name.includes('speech-player'))return {playSpeech(){throw Error('not expected');}};throw Error(name);
 }});
 const component={...definition.methods,data:{...definition.data},setData(v){Object.assign(this.data,v);}};
 const observer=definition.observers['item,childId,date,taskId'];const word=learning.catalogById.get('word-hello');
 observer.call(component,word,'c','2026-10-22','t');component.data.playing=true;
 observer.call(component,{...word},'c','2026-10-22','t');assert.equal(component.data.playing,true);
 observer.call(component,{...word,title:'new word'},'c','2026-10-22','t');assert.equal(component.data.playing,false);
 component.data.playing=true;observer.call(component,word,'different-child','2026-10-22','t');assert.equal(component.data.playing,false);
});

test('installed Tencent SDK remains CommonJS-compatible with patched UUID and constructs TextToVoice requests',async t=>{
 const {createRequire}=require('node:module');
 const sdkRequire=createRequire(require.resolve('../cloudfunctions/familyApi/speech-provider'));
 const {HttpConnection}=sdkRequire('tencentcloud-sdk-nodejs-common/tencentcloud/common/http/http_connection');
 const original=HttpConnection.doRequestWithSign3;let request;
 t.after(()=>{HttpConnection.doRequestWithSign3=original;});
 HttpConnection.doRequestWithSign3=async value=>{request=value;return {status:200,headers:new Map([['content-type','application/json']]),json:async()=>({Response:{Audio:audio,RequestId:'test-request'}})};};
 const {speechProvider}=require('../cloudfunctions/familyApi/speech-provider');
 const provider=speechProvider({TTS_FREE_ONLY:'true',TTS_FREE_EXPIRES_AT:'2027-01-22T02:30:00Z',TTS_SECRET_ID:'test-id',TTS_SECRET_KEY:'test-key'});
 assert.equal(await provider.synthesize('hello','en'),audio);
 assert.equal(request.action,'TextToVoice');assert.equal(request.data.Text,'hello');
 assert.match(request.headers['X-TC-TraceId'],/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
