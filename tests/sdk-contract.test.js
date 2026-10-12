const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sdkRoot = path.resolve(__dirname, '../cloudfunctions/familyApi/node_modules');
const cloud = require(path.join(sdkRoot, 'wx-server-sdk'));
const { Db } = require(path.join(sdkRoot, '@cloudbase/database'));
const { EJSON } = require(path.join(sdkRoot, 'bson'));
const { createCloudStore } = require('../cloudfunctions/familyApi/store');

test('installed WeChat SDK supports transaction reads/writes/results and preserves domain errors', async () => {
  cloud.init({ env: 'contract-test-local-only' });
  const db = cloud.database({ throwOnNotFound: false });
  const original = Db.reqClass;
  let document = null;
  const calls = [];
  Db.reqClass = class {
    async send(action, payload) {
      calls.push(action);
      if (action === 'database.startTransaction') return { transactionId: 'test-transaction' };
      if (action === 'database.getDocument') return { data: { list: document ? [EJSON.stringify(document)] : [] } };
      if (action === 'database.modifyDocument') { document = EJSON.parse(payload.data); return { data: { updated: 1, upsert_id: 'sample' } }; }
      if (['database.commitTransaction', 'database.abortTransaction'].includes(action)) return {};
      throw new Error(`Unexpected network action: ${action}`);
    }
  };
  try {
    const store = createCloudStore(db);
    const result = await store.run(async (tx) => {
      assert.equal(await tx.get('families', 'sample'), null);
      await tx.put('families', 'sample', { name: '测试', members: [], createdAt: 123 });
      assert.equal((await tx.get('families', 'sample')).name, '测试');
      return { accepted: true };
    });
    assert.deepEqual(result, { accepted: true });
    await assert.rejects(store.run(async () => { const error = new Error('domain'); error.code = 'FORBIDDEN'; throw error; }), (error) => error.code === 'FORBIDDEN');
    assert.ok(calls.includes('database.commitTransaction'));
    assert.ok(calls.includes('database.abortTransaction'));
  } finally { Db.reqClass = original; }
});
