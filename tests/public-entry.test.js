const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createService } = require('../cloudfunctions/familyApi/service');

test('public cloud entry ignores private deployment defaults and keeps existing households isolated', async () => {
  const data = new Map();
  const store = { run: async (work) => work({
    get: async (collection, id) => structuredClone(data.get(`${collection}/${id}`) || null),
    put: async (collection, id, value) => data.set(`${collection}/${id}`, structuredClone(value))
  }) };
  const privateDefaults = { name: '私有测试昵称', birthDate: '2020-10-13', age: 6, schoolGrade: 1 };
  const existingService = createService({ store, defaultChild: privateDefaults });
  const existing = (await existingService.execute('existing-parent', 'bootstrap', { ensureDefault: true })).family;
  let currentOpenid = 'new-parent';
  const exported = {};
  const cloud = { init() {}, database() {}, getWXContext: () => ({ OPENID: currentOpenid }) };
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/familyApi/index.js'), 'utf8');
  vm.runInNewContext(source, {
    exports: exported, console,
    process: { env: { DEFAULT_CHILD_NAME: privateDefaults.name, DEFAULT_CHILD_BIRTH_DATE: privateDefaults.birthDate } },
    require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === './service') return { createService };
      if (name === './store') return { createCloudStore: () => store };
      if (name === './speech-provider') return { speechProvider: () => undefined };
      throw new Error(`Unexpected require: ${name}`);
    }
  });
  const newcomer = await exported.main({ action: 'bootstrap', payload: { ensureDefault: true, openid: 'existing-parent' } });
  assert.equal(newcomer.ok, true);
  assert.notEqual(newcomer.data.family.id, existing.id);
  assert.equal(newcomer.data.family.children[0].name, '孩子');
  assert.equal(newcomer.data.family.children[0].birthDate, null);
  const denied = await exported.main({ action: 'getDay', payload: { familyId: existing.id } });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');
  currentOpenid = 'existing-parent';
  const owner = await exported.main({ action: 'bootstrap', payload: { ensureDefault: true } });
  assert.equal(owner.data.family.id, existing.id);
  assert.equal(owner.data.family.children[0].name, privateDefaults.name);
  assert.equal(owner.data.family.children[0].birthDate, privateDefaults.birthDate);
});
