'use strict';
// Administrator tool: local reviewed files -> existing private CloudBase storage.
// No generation API, credential creation or paid resource purchase is performed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {validateBatch} = require('./speech-library');
const {importSpeechAsset} = require('../cloudfunctions/familyApi/speech-library');
const {createCloudStore} = require('../cloudfunctions/familyApi/store');
function billingAllowed(document, envId, now) {
  const row=(document.data?.EnvBillingInfoList||document.EnvBillingInfoList||[]).find(x=>x.EnvId===envId);
  assert.ok(row && row.Status==='NORMAL' && row.PayMode==='PREPAYMENT' && row.EnableOverrun===false,
    'A current prepaid environment with overrun billing disabled is required');
  assert.ok(Date.parse(row.ExpireTime.replace(' ','T')+'+08:00')>now, 'Cloud package has expired');
}
async function main(args) {
  const value=flag=>{const i=args.indexOf(flag);assert.ok(i>=0&&args[i+1],`Missing ${flag}`);return path.resolve(args[i+1]);};
  const manifestFile=value('--manifest'), sessionFile=value('--session'), billingFile=value('--billing'), receiptFile=value('--receipt');
  const parse=p=>{const s=fs.readFileSync(p,'utf8');return JSON.parse(s.slice(s.indexOf('{')));};
  const session=parse(sessionFile).data;assert.ok(session?.envId&&session.secretId&&session.secretKey&&session.token,'Invalid temporary SDK session');
  assert.ok(Date.now()-fs.statSync(billingFile).mtimeMs < 15*60000, 'Refresh the billing check before importing');
  billingAllowed(parse(billingFile),session.envId,Date.now());
  const items=validateBatch(parse(manifestFile),path.dirname(manifestFile));
  const sdk=require('../cloudfunctions/familyApi/node_modules/@cloudbase/node-sdk');
  const cloud=sdk.init({env:session.envId,region:'ap-shanghai',secretId:session.secretId,secretKey:session.secretKey,sessionToken:session.token,timeout:30000});
  const db=cloud.database({throwOnNotFound:false});
  // wx-server-sdk uses set({data}); the local Node SDK uses set(data).
  const store=createCloudStore({runTransaction:work=>db.runTransaction(tx=>work({collection:name=>({doc:id=>({
    get:()=>tx.collection(name).doc(id).get(),set:({data})=>tx.collection(name).doc(id).set(data)
  })})}))});
  const media={upload:async(p,b)=>(await cloud.uploadFile({cloudPath:p,fileContent:b})).fileID,
    download:async fileID=>(await cloud.downloadFile({fileID})).fileContent};
  const receipt={createdAt:new Date().toISOString(),envId:session.envId,bytes:0,items:[]};
  for(const asset of items) {
    const result=await importSpeechAsset(store,media,asset.input,asset.bytes,Date.now());
    receipt.items.push({file:asset.file,key:result.key,bytes:asset.bytes.length,reused:result.reused,digest:asset.input.digest});
    receipt.bytes+=asset.bytes.length;
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    console.log(JSON.stringify({file:asset.file,bytes:asset.bytes.length,reused:result.reused}));
  }
  console.log(JSON.stringify({verifiedAndStored:receipt.items.length,bytes:receipt.bytes}));
}
if(require.main===module) main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({code:error.code||'IMPORT_FAILED',message:String(error.message).slice(0,300)}));process.exitCode=1;});
module.exports={billingAllowed};
