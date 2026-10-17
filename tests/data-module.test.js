const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { dataModule } = require('../scripts/data-module');

test('native data modules preserve JSON values, escaping, optional fields and independent objects', () => {
  const text = 'Repeated source string with 中文, quotes " and newline\n and backslash \\.';
  const value = { a: [text, { text }, null, true, 0, undefined], b: { text, missing: undefined }, c: 's[0]',
    metadata: JSON.parse('{"__proto__":{"label":"ordinary JSON key"}}') };
  const code = dataModule(value);
  const context = { module: { exports: null } }; vm.runInNewContext(code, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.module.exports)), JSON.parse(JSON.stringify(value)));
  assert.equal(dataModule(value), code);
  assert.ok(Object.hasOwn(context.module.exports.metadata, '__proto__'));
  context.module.exports.a[1].text = 'changed';
  assert.equal(context.module.exports.b.text, text);
});

test('packaged client knowledge and source JSON are identical to the cloud data', () => {
  for (const name of ['knowledge-data', 'resources']) {
    const source = require(`../shared/${name}.json`);
    assert.deepEqual(require(`../miniprogram/lib/learning/${name}.js`), source);
    assert.deepEqual(require(`../cloudfunctions/familyApi/learning/${name}.json`), source);
  }
  const lowerPrimary = require('../scripts/lower-primary');
  assert.deepEqual(require('../miniprogram/lib/lower-primary-pinyin'), { ...lowerPrimary.pinyin(), ...lowerPrimary.data.extraPinyin });
});

test('repeated layouts reduce native package bytes without sharing mutable records', () => {
  const source = require('../shared/knowledge-data.json');
  const code = dataModule(source);
  assert.ok(Buffer.byteLength(code) < Buffer.byteLength(JSON.stringify(source)) * 0.55);
  const samples = [null, [], {}, 0, false, 'plain', { a: 1, b: 2 }, { b: 3, a: 4 }];
  const context = { module: { exports: null } };
  vm.runInNewContext(dataModule(samples), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.module.exports)), samples);
  assert.deepEqual(Object.keys(context.module.exports[6]), ['a', 'b']);
  assert.deepEqual(Object.keys(context.module.exports[7]), ['b', 'a']);
  context.module.exports[6].a = 99;
  assert.equal(context.module.exports[7].a, 4);
});

test('unique source prefixes compress deterministically and preserve Unicode, escapes and values', () => {
  const prefix = 'https://example.test/教材/very-long-common-source-path?edition=2024&unit=';
  const values = Array.from({ length: 80 }, (_, i) => ({ source: prefix + i + '\n"\\',
    unicode: '共同前缀'.repeat(10) + (i % 2 ? '😀' : '😁') + i }));
  const code = dataModule(values);
  assert.match(code, /s\.forEach/);
  assert.ok(Buffer.byteLength(code) < Buffer.byteLength(JSON.stringify(values)) * 0.5);
  const context = { module: { exports: null } };
  vm.runInNewContext(code, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.module.exports)), values);
  assert.equal(dataModule(values), code);
  assert.doesNotMatch(dataModule({ short: 'hello' }), /s\.forEach/);
});
