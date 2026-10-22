const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const learning = require('../shared/learning');
const today = '2026-10-12';
const rules = values => learning.emptyRules().map(r => ({ ...r, ...(typeof values[r.kind] === 'number' ? {quantity: values[r.kind]} : values[r.kind] || {}) }));
async function setup() {
 const f = fixture({media:{upload:async()=>'private-file',download:async()=>Buffer.from([255,216,255,0])}}); const family = await f.family(); const childId = family.children[0].id;
 const call = (a,p={}) => f.call('parent-a',a,{familyId:family.id,childId,...p});
 let seq=0;
 const save = async (rs,extra={}) => { const fresh=(await f.call('parent-a','bootstrap',{})).family; const set=learning.templateSet(fresh,childId); return call('saveDailyTemplate',{templateId:set.activeId,name:'每日积累',rules:rs,activate:false,baseRevision:set.revision,mutationId:`today-${++seq}`,applyToday:true,...extra}); };
 const day = async (date=today) => (await call('getDay',{date})).day;
 return {f,family,childId,call,save,day};
}
test('opt-in template edits update today without replacing completed, touched, manual or sibling tasks',async()=>{
 const s=await setup(); await s.save(rules({word:4,poetry:2}));
 const sibling=(await s.call('addChild',{name:'另一个孩子'})).family.children[1];
 await s.call('addPlan',{title:'家长安排',detail:'读一页',subject:'reading',kind:'reading',schedule:'once',date:today,minutes:1});
 let d=await s.day(); const words=d.tasks.filter(t=>t.kind==='word'&&t.childId===s.childId);
 await s.call('setTaskDone',{date:today,taskId:words[0].id,done:true,baseVersion:0,mutationId:'completed'});
 await s.call('setTaskDone',{date:today,taskId:words[1].id,done:true,baseVersion:0,mutationId:'touch'});
 await s.call('setTaskDone',{date:today,taskId:words[1].id,done:false,baseVersion:1,mutationId:'undo'});
 const before=await s.day(); const preserved=before.tasks.filter(t=>t.done||t.version>0||!t.id.startsWith('a_')||t.childId===sibling.id);
 await s.save(rules({word:1,poetry:0})); const after=await s.day();
 for(const t of preserved) assert.deepEqual(after.tasks.find(x=>x.id===t.id),t);
 assert.equal(after.tasks.filter(t=>t.childId===s.childId&&t.kind==='word').length,2);
 assert.equal(after.tasks.filter(t=>t.childId===s.childId&&t.kind==='poetry').length,0);
 const records=(await s.call('getHistory')).items;
 assert.ok(records.some(r=>r.id===words[0].contentId || r.item?.id===words[0].contentId));
 const stable=after.tasks; await s.save(rules({word:5,poetry:0})); d=await s.day();
 assert.equal(d.tasks.filter(t=>t.childId===s.childId&&t.kind==='word').length,5);
 for(const t of stable) assert.deepEqual(d.tasks.find(x=>x.id===t.id),t);
});
test('pending homework locks its whole group while other kinds update; duplicates and previous dates stay intact',async()=>{
 const s=await setup(); await s.save(rules({word:3,poetry:1})); const before=await s.day();
 const invite=await s.call('createInvite',{role:'child',guardianConsent:true}); await s.f.call('child','joinFamily',{code:invite.code,memberName:'孩子'});
 const attachment=await s.f.call('child','uploadHomeworkAttachment',{familyId:s.family.id,childId:s.childId,date:today,kind:'word',uploadId:'photo',mime:'image/jpeg',base64:Buffer.from([255,216,255,0]).toString('base64'),duration:0});
 await s.f.call('child','submitHomework',{familyId:s.family.id,childId:s.childId,date:today,kind:'word',submissionId:'homework',attachmentIds:[attachment.attachmentId],baseVersion:0});
 await s.save(rules({word:10,poetry:3})); const after=await s.day();
 assert.deepEqual(after.tasks.filter(t=>t.kind==='word'),before.tasks.filter(t=>t.kind==='word'));
 assert.equal(after.tasks.filter(t=>t.kind==='poetry').length,3);
 s.f.advance(86400000); await s.save(rules({word:1,poetry:0})); assert.deepEqual((await s.day()).tasks,after.tasks);
});
test('inactive templates do not change today and an active edit can be retried without reshuffling',async()=>{
 const s=await setup(); const before=await s.day();
 await s.save(rules({word:10}),{templateId:'weekend',name:'周末'}); assert.deepEqual((await s.day()).tasks,before.tasks);
 const state=learning.templateSet((await s.f.call('parent-a','bootstrap',{})).family,s.childId);
 const input={templateId:state.activeId,name:'每日积累',rules:rules({word:5}),activate:false,applyToday:true,baseRevision:state.revision,mutationId:'retry'};
 await s.call('saveDailyTemplate',input); const first=await s.day();
 assert.equal((await s.call('saveDailyTemplate',input)).duplicate,true); assert.deepEqual(await s.day(),first);
 await assert.rejects(s.call('saveDailyTemplate',{...input,applyToday:false}),{code:'INVALID'});
});
test('same-device queued check-ins flush before template shrink; offline saving cannot discard them',async()=>{
 const s=await setup(); await s.save(rules({word:4})); const c=s.f.client('parent-a'); await c.engine.sync(today);
 const word=c.engine.viewDay(today).tasks[0]; c.engine.enqueue(today,word.id,true);
 const set=learning.templateSet(c.engine.state.family,s.childId);
 const input={childId:s.childId,templateId:set.activeId,baseRevision:set.revision,name:'每日积累',rules:rules({word:0}),activate:false,applyToday:true,mutationId:'queued'};
 c.offline(); await assert.rejects(c.engine.command('saveDailyTemplate',input),/先联网同步/); assert.equal(c.engine.state.queue.length,1);
 c.online(); await c.engine.command('saveDailyTemplate',input);
 assert.equal(c.engine.state.queue.length,0); assert.equal((await s.day()).tasks.find(t=>t.id===word.id).done,true);
});
