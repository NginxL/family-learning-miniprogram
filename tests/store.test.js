const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudStore } = require('../cloudfunctions/familyApi/store');

function mockDb(doc) { return { runTransaction: (fn) => fn({ collection: () => ({ doc: () => doc }) }) }; }
test('cloud adapter recognizes missing documents but propagates permission/network failures', async () => {
  const missing = createCloudStore(mockDb({ get: async () => { throw { errCode: -502005 }; } }));
  assert.equal(await missing.run((tx) => tx.get('families', 'id')), null);
  const network = createCloudStore(mockDb({ get: async () => { throw new Error('network'); } }));
  await assert.rejects(network.run((tx) => tx.get('families', 'id')), /network/);
});
test('cloud adapter supports SDK document shapes and strips immutable _id on writes', async () => {
  let saved;
  const store = createCloudStore(mockDb({ get: async () => ({ data: [{ _id: 'id', name: 'test' }] }), set: async (value) => { saved = value; } }));
  const value = await store.run((tx) => tx.get('families', 'id'));
  assert.equal(value.name, 'test');
  await store.run((tx) => tx.put('families', 'id', value));
  assert.deepEqual(saved, { data: { name: 'test' } });
});
