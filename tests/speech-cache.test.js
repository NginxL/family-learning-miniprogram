const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSpeechService } = require('../cloudfunctions/familyApi/speech');
const { speechHash, speechContentKey, speechVoiceKey } = require('../shared/speech-profile');
const learning = require('../shared/learning');
const audio = Buffer.from('ID3-saved-audio').toString('base64');
const now = Date.parse('2026-10-22T02:00:00Z');
const request = { familyId: 'family', childId: 'child', contentId: 'word-hello', part: 0 };

function fixture() {
  const docs = new Map([
    ['profiles/parent', { familyId: 'family' }], ['profiles/child-user', { familyId: 'family' }],
    ['families/family', { children: [{ id: 'child' }], members: [{ id: 'parent', role: 'owner' }, { id: 'child-user', role: 'child', childId: 'child' }], plans: [] }],
    ['learning/history', { records: { old: { learned: true } } }]
  ]);
  let lock = Promise.resolve();
  const store = { run(fn) {
    const result = lock.then(async () => {
      const draft = structuredClone(docs);
      const value = await fn({ get: async (c,id) => structuredClone(draft.get(`${c}/${id}`) || null), put: async (c,id,v) => draft.set(`${c}/${id}`, structuredClone(v)) });
      docs.clear(); draft.forEach((v,k) => docs.set(k,v)); return value;
    });
    lock = result.catch(() => {}); return result;
  } };
  let calls = 0, uploads = 0, downloads = 0;
  const files = new Map();
  const provider = { expiresAt: now + 86400000, voiceKey: speechVoiceKey, async synthesize() { calls++; return audio; } };
  const media = { async upload(p,b) { uploads++; files.set(p,Buffer.from(b)); return p; }, async download(p) { downloads++; if(!files.has(p)) throw Error('Missing object'); return files.get(p); } };
  return { docs, store, provider, media, files, counts: () => ({ calls, uploads, downloads }), service: () => createSpeechService(store,provider,media) };
}
test('speech cache SHA-256 agrees with Node for ASCII, Chinese, surrogate pairs, long audio and lone surrogates', () => {
  for (const value of ['', 'abc', '你好，末末！🌱', '\ud800', audio.repeat(30000), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)])
    assert.equal(speechHash(value), crypto.createHash('sha256').update(value).digest('hex'));
});
test('persistent audio survives another instance/day and free synthesis expiry without changing historical records', async () => {
  const f=fixture(), history=structuredClone(f.docs.get('learning/history'));
  const first=await f.service()('parent',request,now);
  assert.equal(first.persistent,true); assert.equal(first.textHash,speechHash('hello')); assert.equal(first.digest,speechHash(audio));
  f.provider.expiresAt=0;
  const next=await f.service()('child-user',request,now+86400000*5);
  assert.equal(next.base64,first.base64); assert.equal(next.key,first.key);
  assert.deepEqual(f.counts(),{calls:1,uploads:1,downloads:1});
  assert.equal(f.docs.get('speechUsage/speech-v1').characters,5);
  assert.deepEqual(f.docs.get('learning/history'),history);
  assert.ok([...f.docs.values()].filter(v=>v.state==='ready').every(v=>!('base64' in v)));
});
test('persistent cache always checks household and child access, including after a slow download', async () => {
  const f=fixture(); await f.service()('parent',request,now);
  await assert.rejects(f.service()('stranger',request,now),{code:'FORBIDDEN'});
  await assert.rejects(f.service()('child-user',{...request,childId:'another'},now),{code:'FORBIDDEN'});
  const original=f.media.download;
  f.media.download=async id=>{const value=await original(id);f.docs.get('families/family').members=[];return value;};
  await assert.rejects(f.service()('parent',request,now),{code:'FORBIDDEN'});
  assert.equal(f.counts().calls,1);
});
test('changed narration text or voice uses a new object; dates/task IDs do not change the audio identity', async () => {
  const f=fixture();
  const a=await f.service()('parent',request,now);
  const b=await f.service()('parent',{...request,date:'2026-10-22',taskId:'task'},now);
  assert.equal(a.key,b.key); assert.equal(f.counts().calls,1);
  f.provider.voiceKey=lang=>speechVoiceKey(lang)+'-new-voice';
  const c=await f.service()('parent',request,now); assert.notEqual(c.key,a.key); assert.equal(f.counts().calls,2);
  const d=await f.service()('parent',{...request,contentId:'word-book'},now);assert.notEqual(c.key,d.key);assert.equal(f.counts().calls,3);
});
test('editing the body of the same custom content creates a new audio while a source-note-only edit reuses it', async () => {
  const f=fixture();f.docs.get('families/family').plans=[{id:'custom',childId:'child',kind:'reading',title:'阅读',detail:'春天来了。\n学习提示：旧说明'}];
  const p={...request,contentId:'custom'};const first=await f.service()('parent',p,now);
  f.docs.get('families/family').plans[0].detail='春天来了。\n学习提示：新说明';
  assert.equal((await f.service()('parent',p,now)).key,first.key);assert.equal(f.counts().calls,1);
  f.docs.get('families/family').plans[0].detail='夏天来了。\n学习提示：新说明';
  assert.notEqual((await f.service()('parent',p,now)).key,first.key);assert.equal(f.counts().calls,2);
});
test('cross-instance concurrent misses hold a database lease and synthesize once', async () => {
  const f=fixture();let finish,started;
  const beginning=new Promise(resolve=>started=resolve);
  const original=f.provider.synthesize;
  f.provider.synthesize=async()=>{started();await new Promise(resolve=>finish=resolve);return original();};
  const first=f.service()('parent',request,now);await beginning;
  await assert.rejects(f.service()('child-user',request,now),{code:'SPEECH_PENDING'});
  finish();await first;await f.service()('child-user',request,now+1000);
  assert.deepEqual(f.counts(),{calls:1,uploads:1,downloads:1});
});
test('upload failure stages the synthesized audio; retry uploads it even after the free period without another synthesis', async () => {
  const f=fixture(), original=f.media.upload;let failed=false;
  f.media.upload=async(p,b)=>{if(!failed){failed=true;throw Error('Upload unavailable');}return original(p,b);};
  await assert.rejects(f.service()('parent',request,now),/Upload unavailable/);
  assert.equal([...f.docs.values()].find(v=>v.state==='pending').base64,audio);
  f.provider.expiresAt=0;
  await f.service()('parent',request,now+1000);
  assert.equal(f.counts().calls,1);assert.equal(f.counts().uploads,1);
});
test('missing or corrupted cloud audio does not silently spend synthesis quota again', async () => {
  const f=fixture();await f.service()('parent',request,now);
  const key=[...f.files.keys()][0];f.files.set(key,Buffer.from('ID3-corrupted'));
  await assert.rejects(f.service()('parent',request,now),{code:'SPEECH_UNAVAILABLE'});
  f.files.delete(key);await assert.rejects(f.service()('parent',request,now),/Missing object/);
  assert.equal(f.counts().calls,1);
});
test('storage and transfer caps stop before generating/downloading and never evict existing audio', async () => {
  const {SPEECH_STORAGE_LIMIT,SPEECH_TRANSFER_LIMIT}=require('../cloudfunctions/familyApi/persistent-speech');
  const {chinaDate}=require('../cloudfunctions/familyApi/validation');const f=fixture();
  f.docs.set('speechUsage/speech-storage-v1',{characters:0,bytes:SPEECH_STORAGE_LIMIT});
  await assert.rejects(f.service()('parent',request,now),{code:'SPEECH_LIMIT'});assert.equal(f.counts().calls,0);
  f.docs.delete('speechUsage/speech-storage-v1');await f.service()('parent',request,now);
  f.docs.set(`speechUsage/speech-transfer-v1:${chinaDate(now)}`,{characters:0,bytes:SPEECH_TRANSFER_LIMIT});
  await assert.rejects(f.service()('parent',request,now),{code:'SPEECH_LIMIT'});
  assert.equal(f.files.size,1);assert.equal(f.counts().downloads,0);
});

function wxDisk(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speech-cache-test-'));
  const filesystem={readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync,renameSync:fs.renameSync,statSync:fs.statSync,readdirSync:fs.readdirSync,unlinkSync:fs.unlinkSync,
    mkdirSync:(p,recursive)=>fs.mkdirSync(p,{recursive}),unlink:o=>{try{fs.unlinkSync(o.filePath);}catch{}},
    writeFile(o){try{fs.writeFileSync(o.filePath,o.data,{encoding:o.encoding});o.success();}catch{ o.fail(); }} };
  const played=[];
  global.wx={env:{USER_DATA_PATH:dir},getFileSystemManager:()=>filesystem,createInnerAudioContext:()=>({onEnded(fn){this.ended=fn;},onError(){},onStop(){},destroy(){},play(){played.push(this.src);queueMicrotask(()=>this.ended());}})};
  t.after(()=>{delete global.wx;fs.rmSync(dir,{recursive:true,force:true});});return {dir,played,filesystem};
}
const resultFor=(text)=>({base64:audio,mime:'audio/mpeg',part:0,parts:1,key:'cloud-key',persistent:true,textHash:speechHash(text),voiceKey:speechVoiceKey('en'),digest:speechHash(audio)});
function engine(transport,user='parent') { return {state:{userId:user,family:{id:'family',myRole:'owner',children:[{id:'child'}]}},snapshot(){return this.state;},subscribe(){return ()=>{};},transport}; }
function play(engine,item,date,taskId,accent) {
  const {playSpeech}=require('../miniprogram/lib/speech-player');
  return new Promise(resolve=>{let last;playSpeech(engine,item,'child',date,taskId,s=>{last=s;if(!s.loading&&!s.playing)queueMicrotask(()=>resolve(last));},accent);});
}
test('both English accents stay distinct in memory and on disk and replay offline without another request',async t=>{
  const disk=wxDisk(t),{libraryVoiceKey}=require('../shared/speech-profile'),requests=[];
  const client=engine(async(action,p)=>{requests.push(p.accent);const base64=Buffer.from(`ID3-${p.accent}`).toString('base64');
    return {...resultFor('hello'),voiceKey:libraryVoiceKey('en',p.accent),base64,digest:speechHash(base64)};});
  const item=learning.catalogById.get('word-hello');
  await play(client,item,undefined,undefined,'en-GB');await play(client,item,undefined,undefined,'en-US');
  assert.deepEqual(requests,['en-GB','en-US']);assert.notEqual(disk.played[0],disk.played[1]);
  client.transport=async()=>{throw Error('offline');};
  for(const accent of ['en-GB','en-US'])assert.equal((await play(client,item,undefined,undefined,accent)).error,'');
  assert.equal(disk.played[0],disk.played[2]);assert.equal(disk.played[1],disk.played[3]);
});
test('a legacy server that ignores accent never plays or saves its generic response as British or American',async t=>{
  const disk=wxDisk(t);const client=engine(async()=>resultFor('hello'),'legacy-user'),item=learning.catalogById.get('word-hello');
  await play(client,item);const before=disk.played.length;
  const result=await play(client,item,undefined,undefined,'en-GB');
  assert.match(result.error,/未返回所选口音/);assert.equal(disk.played.length,before);
});
test('phone saves automatically and reuses files after module restart, across days and entry points without a network request', async t => {
  const disk=wxDisk(t);let requests=0;
  const client=engine(async()=>{requests++;return resultFor('hello');});const word=learning.catalogById.get('word-hello');
  await play(client,word,'2026-10-22','task1');assert.equal(requests,1);assert.ok(fs.existsSync(disk.played[0]));
  delete require.cache[require.resolve('../miniprogram/lib/speech-player')];delete require.cache[require.resolve('../miniprogram/lib/speech-cache')];
  client.transport=async()=>{throw Error('offline');};
  assert.equal((await play(client,word,'2026-10-23','task2')).error,'');
  assert.equal((await play(client,word)).error,'');assert.equal(disk.played.length,3);
  assert.equal(new Set(disk.played).size,1);assert.ok(fs.existsSync(disk.played[0]));
});
test('local corrupt files are refetched, account scopes remain separate and voice/text changes miss the cache', async t => {
  wxDisk(t);const {readSavedSpeech,saveSpeech}=require('../miniprogram/lib/speech-cache');const voice=speechVoiceKey('en');
  const p=saveSpeech('account-a','hello',voice,resultFor('hello'));assert.ok(p);
  assert.equal(readSavedSpeech('account-a','hello',voice),p);
  assert.equal(readSavedSpeech('account-b','hello',voice),undefined);
  assert.equal(readSavedSpeech('account-a','hello',voice+'changed'),undefined);
  assert.equal(readSavedSpeech('account-a','book',voice),undefined);
  fs.writeFileSync(p,'bad');assert.equal(readSavedSpeech('account-a','hello',voice),undefined);
  assert.ok(saveSpeech('account-a','hello',voice,resultFor('hello')));
  assert.equal(saveSpeech('account-a','hello',voice,{...resultFor('hello'),persistent:undefined}),undefined);
});
test('local capacity/write failure preserves previously saved files; no silent eviction', t => {
  const disk=wxDisk(t);const {saveSpeech}=require('../miniprogram/lib/speech-cache');const voice=speechVoiceKey('en');
  const first=saveSpeech('a','hello',voice,resultFor('hello'));assert.ok(first);
  const original=disk.filesystem.writeFileSync;disk.filesystem.writeFileSync=()=>{throw Error('No space');};
  assert.equal(saveSpeech('a','book',voice,resultFor('book')),undefined);
  disk.filesystem.writeFileSync=original;assert.ok(fs.existsSync(first));assert.equal(fs.readFileSync(first,'base64'),audio);
});
test('new speech routing leaves all household calls and legacy default routing on familyApi', async () => {
  const {createCloudTransport}=require('../miniprogram/lib/cloud-transport');const calls=[];
  const cloud={callFunction:async v=>{calls.push(v.name);return {result:{ok:true,data:{}}};}};
  const next=createCloudTransport(cloud,'env','familySpeechPreview');await next('getSpeech',request);await next('bootstrap',{});
  await createCloudTransport(cloud,'env')('getSpeech',request);
  assert.deepEqual(calls,['familySpeechPreview','familyApi','familyApi']);
});
test('reviewed Doubao audio is automatically saved and reused offline without changing phone cache policy',async t=>{
  const disk=wxDisk(t), {libraryVoiceKey}=require('../shared/speech-profile');let requests=0;
  const client=engine(async()=>{requests++;return {...resultFor('hello'),voiceKey:libraryVoiceKey('en')};});
  const item=learning.catalogById.get('word-hello');await play(client,item);assert.equal(requests,1);
  client.transport=async()=>{throw Error('offline');};delete require.cache[require.resolve('../miniprogram/lib/speech-player')];
  assert.equal((await play(client,item)).error,'');assert.equal(new Set(disk.played).size,1);assert.ok(fs.existsSync(disk.played[0]));
});
