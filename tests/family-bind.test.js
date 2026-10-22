const test=require('node:test'); const assert=require('node:assert/strict');
function page() {let definition; global.Page=d=>definition=d; const path=require.resolve('../miniprogram/pages/family/index'); delete require.cache[path]; require(path); return {...definition, data:{...structuredClone(definition.data),family:{id:'family',myRole:'owner'},children:[{id:'child',name:'小树'}]},setData(p){Object.assign(this.data,p);}};} const event={currentTarget:{dataset:{id:'child'}}};
test('binding passes WeChat modal limits and displays the code next to the child',async t=>{
 const p=page(); t.after(()=>{delete global.Page;delete global.wx;}); let calls=0;
 global.wx={showModal(o){if([...o.confirmText].length>4)return o.fail({errMsg:'confirmText too long'});o.success({confirm:true});},showToast(){}};
 p.perform=async(a,body)=>{calls++;assert.equal(a,'createInvite');assert.deepEqual(body,{role:'child',childId:'child',guardianConsent:true});return {code:'test-code'};};
 await p.createChildInvite(event); assert.equal(calls,1);assert.equal(p.data.inviteChildId,'child');assert.equal(p.data.inviteCode,'test-code');assert.equal(p.data.bindingChildId,'');
});
test('binding cancellation, repeated taps, platform failure and changed family never silently issue invitations',async t=>{
 const p=page();t.after(()=>{delete global.Page;delete global.wx;});let callback,calls=0;const toasts=[];
 global.wx={showModal(o){callback=o;},showToast(o){toasts.push(o.title);}};p.perform=async()=>{calls++;return {code:'test'};};
 const first=p.createChildInvite(event);await p.createChildInvite(event); assert.equal(calls,0);callback.success({confirm:false});await first;
 const failed=p.createChildInvite(event);callback.fail({errMsg:'platform'});await failed;assert.match(toasts[0],/未打开/);assert.equal(p.data.bindingChildId,'');
 const moved=p.createChildInvite(event);p.data.family.id='other';callback.success({confirm:true});await moved;assert.equal(calls,0);
});
