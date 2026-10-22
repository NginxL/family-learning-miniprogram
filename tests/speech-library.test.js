const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeechService, SPEECH_BUDGET } = require('../cloudfunctions/familyApi/speech');
const { importSpeechAsset, FreeSpeechUnavailable, SPEECH_STORAGE_LIMIT, SPEECH_TRANSFER_LIMIT } = require('../cloudfunctions/familyApi/speech-library');
const { hash, chinaDate, DomainError } = require('../cloudfunctions/familyApi/validation');
const { libraryVoiceKey, speechContentKey, speechVoiceKey } = require('../shared/speech-profile');
const now = Date.parse('2026-10-22T02:00:00Z'), audio = Buffer.from('ID3-verified-library');
const request = {familyId:'family', childId:'child', contentId:'word-hello', part:0};
function fixture() {
  const docs = new Map([['profiles/parent',{familyId:'family'}],['families/family',{members:[{id:'parent',role:'owner'}],children:[{id:'child'}],plans:[]}]]);
  let lock=Promise.resolve(), calls=0, uploads=0, downloads=0;
  const store={run(fn){const job=lock.then(async()=>{const next=structuredClone(docs); const value=await fn({get:async(c,id)=>structuredClone(next.get(`${c}/${id}`)||null),put:async(c,id,v)=>next.set(`${c}/${id}`,structuredClone(v))});docs.clear();next.forEach((v,k)=>docs.set(k,v));return value;});lock=job.catch(()=>{});return job;}};
  const files=new Map(), media={upload:async(p,b)=>{uploads++;files.set(p,Buffer.from(b));return p;},download:async p=>{downloads++;if(!files.has(p))throw Error('Missing object');return files.get(p);}};
  const provider={expiresAt:now+60000,voiceKey:speechVoiceKey,synthesize:async()=>{calls++;return Buffer.from('ID3-Tencent').toString('base64');}};
  const input={text:'hello',textHash:hash('hello'),voiceKey:libraryVoiceKey('en'),language:'en',digest:hash(audio.toString('base64')),bytes:audio.length,duration:1.2,batchId:'test',verifiedAt:now,review:'test reviewed fixture',references:[{contentId:'word-hello',part:0}]};
  return {docs,store,media,provider,files,input,counts:()=>({calls,uploads,downloads}),import:()=>importSpeechAsset(store,media,input,audio,now),speak:()=>createSpeechService(store,provider,media,true)};
}
test('verified import is immutable, idempotent and reserves actual bytes once',async()=>{
  const f=fixture(); const a=await f.import(), b=await f.import();assert.equal(a.reused,false);assert.equal(b.reused,true);assert.equal(a.key,b.key);
  assert.equal(f.docs.get('speechUsage/speech-storage-v1').bytes,audio.length);assert.deepEqual(f.counts(),{calls:0,uploads:1,downloads:1});
  const changed=Buffer.from('ID3-changed');await assert.rejects(importSpeechAsset(f.store,f.media,{...f.input,bytes:changed.length,digest:hash(changed.toString('base64'))},changed,now),{code:'CONFLICT'});
});
test('failed import never becomes playable and retry reuses its reservation',async()=>{
  const f=fixture(),download=f.media.download;f.media.download=async()=>Buffer.from('ID3-wrong');
  await assert.rejects(f.import(),{code:'SPEECH_UNAVAILABLE'});f.provider.expiresAt=0;
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_BACKUP_PENDING'});
  f.media.download=download;await f.import();assert.equal(f.docs.get('speechUsage/speech-storage-v1').bytes,audio.length);
  assert.equal((await f.speak()('parent',request,now)).base64,audio.toString('base64'));
});
test('expiry or total free budget automatically selects reviewed library audio without synthesis',async()=>{
  for(const reason of ['expired','budget']){const f=fixture();await f.import();if(reason==='expired')f.provider.expiresAt=0;else f.docs.set('speechUsage/speech-v1',{characters:SPEECH_BUDGET});
    const a=await f.speak()('parent',request,now),b=await f.speak()('parent',request,now+1000);
    assert.equal(a.base64,audio.toString('base64'));assert.equal(a.voiceKey,libraryVoiceKey('en'));assert.equal(a.key,b.key);assert.equal(a.persistent,true);
    assert.equal(f.counts().calls,0);assert.equal(f.counts().uploads,1);
  }
});
test('provider free-limit response latches until the free expiry and stops repeated synthesis attempts',async()=>{
  const f=fixture();await f.import();let attempts=0;f.provider.synthesize=async()=>{attempts++;throw new FreeSpeechUnavailable('SPEECH_LIMIT','No free resources');};
  await f.speak()('parent',request,now);await f.speak()('parent',request,now+1000);assert.equal(attempts,1);
  assert.equal(f.docs.get('speechUsage/speech-provider-v1').disabledUntil,f.provider.expiresAt);
});
test('Tencent is preferred while free; its saved audio is reused after expiry',async()=>{
  const f=fixture();await f.import();const first=await f.speak()('parent',request,now);assert.equal(first.voiceKey,speechVoiceKey('en'));f.provider.expiresAt=0;
  assert.equal((await f.speak()('parent',request,now)).base64,first.base64);assert.equal(f.counts().calls,1);
});
test('missing, unverified or stale-text backup never calls a paid or alternative generator',async()=>{
  const f=fixture();f.provider.expiresAt=0;await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_BACKUP_PENDING'});await f.import();
  await assert.rejects(f.speak()('parent',{...request,contentId:'word-book'},now),{code:'SPEECH_BACKUP_PENDING'});
  f.docs.get(`speechAssets/${speechContentKey('hello',libraryVoiceKey('en'))}`).verifiedAt=0;
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_UNAVAILABLE'});assert.equal(f.counts().calls,0);
});
test('library access retains household/child authorization and never exposes private custom text',async()=>{
  const f=fixture();await f.import();f.provider.expiresAt=0;
  await assert.rejects(f.speak()('stranger',request,now),{code:'FORBIDDEN'});
  await assert.rejects(f.speak()('parent',{...request,childId:'other'},now),{code:'FORBIDDEN'});
  f.docs.get('families/family').plans=[{id:'custom',childId:'child',kind:'word',title:'hello'}];
  await assert.rejects(f.speak()('parent',{...request,contentId:'custom'},now),{code:'SPEECH_UNAVAILABLE'});
  const original=f.media.download;f.media.download=async id=>{const value=await original(id);f.docs.get('families/family').members=[];return value;};
  await assert.rejects(f.speak()('parent',request,now),{code:'FORBIDDEN'});
});
test('storage, transfer, corruption and permission errors do not trigger fallback',async()=>{
  const f=fixture();await f.import();f.docs.set('speechUsage/speech-storage-v1',{characters:0,bytes:SPEECH_STORAGE_LIMIT});const before=f.counts();
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_LIMIT'});assert.deepEqual(f.counts(),before);
  f.docs.delete('speechUsage/speech-storage-v1');f.provider.synthesize=async()=>{throw new DomainError('SPEECH_UNAVAILABLE','Auth error');};
  await assert.rejects(f.speak()('parent',request,now),/Auth error/);
  f.provider.expiresAt=0;f.docs.set(`speechUsage/speech-transfer-v1:${chinaDate(now)}`,{characters:0,bytes:SPEECH_TRANSFER_LIMIT});
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_LIMIT'});assert.equal(f.counts().downloads,before.downloads);
  f.docs.delete(`speechUsage/speech-transfer-v1:${chinaDate(now)}`);f.files.set([...f.files.keys()][0],Buffer.from('ID3-tampered'));
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_UNAVAILABLE'});
});
test('queue uses exact public narration chunks, deduplicated by text and voice; no audio enters package',()=>{
  const {queue}=require('../scripts/speech-library');const items=queue();assert.ok(items.length>3000);assert.equal(new Set(items.map(x=>x.key)).size,items.length);
  const hello=items.find(x=>x.text==='hello');assert.ok(hello.references.some(x=>x.contentId==='word-hello'));assert.equal(hello.key,speechContentKey('hello',libraryVoiceKey('en')));
});
test('explicit British and American recordings coexist; neither synthesizes nor falls back to an unclassified voice',async()=>{
  const f=fixture();await f.import();const snapshots=structuredClone(f.docs.get('families/family'));
  const gb=Buffer.from('ID3-reviewed-GB'),us=Buffer.from('ID3-reviewed-US');
  for(const [accent,bytes] of [['en-GB',gb],['en-US',us]]) {
    const input={...f.input,accent,accentReview:'Test-only listening review fixture',voiceKey:libraryVoiceKey('en',accent),bytes:bytes.length,digest:hash(bytes.toString('base64'))};
    await importSpeechAsset(f.store,f.media,input,bytes,now);
    const result=await f.speak()('parent',{...request,accent},now);
    assert.equal(result.base64,bytes.toString('base64'));assert.equal(result.voiceKey,input.voiceKey);
  }
  assert.equal(f.counts().calls,0);
  assert.deepEqual(f.docs.get('families/family'),snapshots);
  assert.equal(f.docs.get('speechUsage/speech-storage-v1').bytes,audio.length+gb.length+us.length);
  await assert.rejects(f.speak()('stranger',{...request,accent:'en-GB'},now),{code:'FORBIDDEN'});
  await assert.rejects(f.speak()('parent',{...request,accent:'en-GB',contentId:'word-book'},now),{code:'SPEECH_BACKUP_PENDING'});
  assert.equal(f.counts().calls,0);
});
test('accent imports require separate evidence, and invalid or missing dialect assets fail closed even with generic audio available',async()=>{
  const f=fixture();await f.import();
  const gb={...f.input,accent:'en-GB',voiceKey:libraryVoiceKey('en','en-GB')};
  await assert.rejects(importSpeechAsset(f.store,f.media,gb,audio,now),{code:'INVALID'});
  await assert.rejects(importSpeechAsset(f.store,f.media,{...gb,accentReview:'prompt only',voiceKey:libraryVoiceKey('en')},audio,now),{code:'INVALID'});
  await assert.rejects(f.speak()('parent',{...request,accent:'en-GB'},now),{code:'SPEECH_BACKUP_PENDING'});
  await assert.rejects(f.speak()('parent',{...request,accent:'en-AU'},now),{code:'INVALID'});
  await assert.rejects(f.speak()('parent',{...request,accent:'en-US',contentId:'poem-goose'},now),{code:'INVALID'});
  assert.equal(f.counts().calls,0);
  await importSpeechAsset(f.store,f.media,{...gb,accentReview:'Test listening review fixture'},audio,now);
  f.docs.get(`speechAssets/${speechContentKey('hello',gb.voiceKey)}`).accentReview='';
  await assert.rejects(f.speak()('parent',{...request,accent:'en-GB'},now),{code:'SPEECH_UNAVAILABLE'});
});
test('general fallback reuses reviewed dialects after free expiry without manufacturing a duplicate general asset',async()=>{
  const f=fixture();f.provider.expiresAt=0;
  const gb={...f.input,accent:'en-GB',accentReview:'Test listening review fixture',voiceKey:libraryVoiceKey('en','en-GB')};
  await importSpeechAsset(f.store,f.media,gb,audio,now);
  const result=await f.speak()('parent',request,now);
  assert.equal(result.voiceKey,gb.voiceKey);
  assert.equal(result.key,speechContentKey('hello',gb.voiceKey));
  assert.equal(f.docs.has(`speechAssets/${speechContentKey('hello',libraryVoiceKey('en'))}`),false);
  assert.equal(f.counts().calls,0);
  await assert.rejects(f.speak()('parent',{...request,accent:'en-US'},now),{code:'SPEECH_BACKUP_PENDING'});
  f.docs.get(`speechAssets/${result.key}`).accentReview='';
  await assert.rejects(f.speak()('parent',request,now),{code:'SPEECH_UNAVAILABLE'});
});
test('accent queues retain all legacy identities and cannot mistake general recordings for either dialect',()=>{
  const {queue,pendingQueue}=require('../scripts/speech-library');
  const general=queue(),gb=queue('en-GB'),us=queue('en-US');
  assert.equal(general.length,3990);assert.equal(libraryVoiceKey('en'),'["doubao-work-seed-audio",1,"en","clear-slow",16000,"mp3",32000]');
  assert.equal(gb.length,general.filter(x=>x.language==='en').length);assert.equal(us.length,gb.length);
  assert.ok(gb.every(x=>x.language==='en'&&x.accent==='en-GB'));
  assert.equal(new Set([...general,...gb,...us].map(x=>x.key)).size,general.length+gb.length+us.length);
  const ledger={items:general.map(x=>({...x,status:'stored'}))};
  assert.equal(pendingQueue([ledger],'en-GB').items.length,gb.length);
  assert.throws(()=>queue('en-AU'),/Invalid requested accent/);
});
test('generation queue skips stored audio and keeps uncertain downloads in a separate review queue',()=>{
  const {queue,pendingQueue}=require('../scripts/speech-library');const all=queue(),[stored,uncertain]=all;
  const result=pendingQueue([{items:[{...stored,status:'stored'},{...uncertain,status:'review-pending'}]}]);
  assert.equal(result.items.length,all.length-2);assert.equal(result.storedSegments,1);
  assert.deepEqual(result.reviewPending.map(x=>x.key),[uncertain.key]);
  assert.equal(result.items.some(x=>x.key===stored.key||x.key===uncertain.key),false);
});
test('old text or voice ledgers do not hide a current recording, and forged hashes fail closed',()=>{
  const {queue,pendingQueue}=require('../scripts/speech-library');const item=queue()[0];
  const text=item.text+'old',voiceKey=item.voiceKey+'old';
  const old={...item,text,voiceKey,textHash:hash(text),key:speechContentKey(text,voiceKey),status:'stored'};
  assert.ok(pendingQueue([{items:[old]}]).items.some(x=>x.key===item.key));
  assert.throws(()=>pendingQueue([{items:[{...item,status:'stored',textHash:'wrong'}]}]),/Invalid ledger text hash/);
});
test('batch validator rejects unreviewed, stale, non-catalogue and corrupt audio before uploading',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {validateBatch}=require('../scripts/speech-library');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speech-library-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'hello.mp3'),audio);
  const f=fixture(),item={...f.input,file:'hello.mp3',status:'verified'},manifest={id:'batch',items:[item]};
  assert.equal(validateBatch(manifest,dir)[0].input.references[0].contentId,'word-hello');
  for(const change of [{status:'pending'},{text:'private new content'},{voiceKey:libraryVoiceKey('en')+'changed'},{digest:'0'.repeat(64)},{file:'../hello.mp3'}])
    assert.throws(()=>validateBatch({...manifest,items:[{...item,...change}]},dir));
});
test('admin import refuses missing, expired, postpaid or overrun-enabled cloud plans',()=>{
  const {billingAllowed}=require('../scripts/import-speech-library');const row={EnvId:'env',Status:'NORMAL',PayMode:'PREPAYMENT',EnableOverrun:false,ExpireTime:'2027-01-01 00:00:00'};
  assert.doesNotThrow(()=>billingAllowed({data:{EnvBillingInfoList:[row]}},'env',now));
  for(const change of [{EnvId:'other'},{Status:'ISOLATED'},{PayMode:'POSTPAID'},{EnableOverrun:true},{ExpireTime:'2025-01-01 00:00:00'}])
    assert.throws(()=>billingAllowed({data:{EnvBillingInfoList:[{...row,...change}]}},'env',now));
});
test('parallel admin import bounds active uploads and preserves receipt indices',async()=>{
  const {importReviewedAssets}=require('../scripts/import-speech-library');
  const items=Array.from({length:9},(_,i)=>i), seen=[], receipt=[];
  let active=0,peak=0;
  await importReviewedAssets(items,async item=>{
    active++;peak=Math.max(peak,active);seen.push(item);
    await new Promise(resolve=>setTimeout(resolve,(3-item%3)*2));
    active--;return {key:`key-${item}`};
  },(item,result,index)=>{receipt[index]={item,...result};},3);
  assert.equal(peak,3);assert.equal(active,0);
  assert.deepEqual(seen,items);
  assert.deepEqual(receipt,items.map(item=>({item,key:`key-${item}`})));
});
test('admin import stops scheduling after failure and drains active readbacks into receipt',async()=>{
  const {importReviewedAssets}=require('../scripts/import-speech-library');
  const started=[],stored=[];let release;
  const inFlight=new Promise(resolve=>{release=resolve;});
  const error=new Error('Readback mismatch');
  const job=importReviewedAssets([0,1,2,3],async item=>{
    started.push(item);
    if(item===0)throw error;
    await inFlight;return {key:'verified-1'};
  },(item,result)=>stored.push({item,...result}),2);
  let finished=false;const settled=job.catch(e=>{finished=true;throw e;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);assert.deepEqual(started,[0,1]);
  release();await assert.rejects(settled,e=>e===error);
  assert.deepEqual(started,[0,1]);assert.deepEqual(stored,[{item:1,key:'verified-1'}]);
});
test('admin import rejects unsafe parallelism before touching any asset',async()=>{
  const {importReviewedAssets}=require('../scripts/import-speech-library');let called=false;
  for(const concurrency of [0,5,1.5,NaN])
    await assert.rejects(importReviewedAssets([1],async()=>{called=true;},()=>{},concurrency),/1–4/);
  assert.equal(called,false);
});
