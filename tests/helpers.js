const { createService } = require('../cloudfunctions/familyApi/service');
const { SyncEngine } = require('../miniprogram/lib/sync-engine');
const copy = (value) => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  let database = {};
  let lock = Promise.resolve();
  let time = Date.parse('2026-10-12T10:00:00+08:00');
  let counter = 0;
  const store = {
    run(work) {
      const result = lock.then(async () => {
        const draft = copy(database);
        const data = await work({
          get: async (collection, id) => copy(draft[`${collection}/${id}`] || null),
          put: async (collection, id, value) => { draft[`${collection}/${id}`] = copy(value); }
        });
        database = draft;
        return copy(data);
      });
      lock = result.catch(() => {});
      return result;
    }
  };
  const service = createService({ store, ...options, now: () => time, randomId: () => `id${++counter}`, inviteCode: () => (++counter).toString(16).padStart(24, '0').toUpperCase() });
  const call = (user, action, payload) => service.execute(user, action, payload);
  async function family() {
    const result = await call('parent-a', 'createFamily', { name: '测试学习小屋', memberName: '家长甲', childName: '小树' });
    return result.family;
  }
  async function addParent(familyId, user = 'parent-b') {
    const invite = await call('parent-a', 'createInvite', { familyId });
    await call(user, 'joinFamily', { code: invite.code, memberName: '家长乙' });
  }
  function client(user, storage = memoryStorage()) {
    let online = true;
    let loseResponse = false;
    const transport = async (action, payload) => {
      if (!online) throw new Error('模拟断网');
      const result = await call(user, action, payload);
      if (action === 'setTaskDone' && loseResponse) { loseResponse = false; throw new Error('提交成功但响应丢失'); }
      return result;
    };
    const engine = new SyncEngine({ storage, transport, makeId: () => `m${++counter}` });
    return { engine, storage, offline: () => { online = false; }, online: () => { online = true; }, loseNextResponse: () => { loseResponse = true; } };
  }
  return { call, family, addParent, client, inspect: () => copy(database), advance: (ms) => { time += ms; } };
}
function memoryStorage() {
  let value = null;
  return { read: () => copy(value), write: (next) => { value = copy(next); } };
}
module.exports = { fixture, memoryStorage };
