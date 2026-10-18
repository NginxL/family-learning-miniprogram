'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../miniprogram');

function nativeRuntime(mode) {
  const storage = new Map();
  const modules = new Map();
  let app;
  let page;
  const components = [];
  let cloudCalls = 0;
  const context = vm.createContext({
    console,
    setInterval: () => 1,
    clearInterval() {},
    App: (value) => { app = value; },
    Page: (value) => { page = value; },
    Component: (value) => { components.push(value); },
    getApp: () => app,
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
      onNetworkStatusChange() {},
      showToast() {},
      switchTab() {},
      cloud: {
        init() {},
        async callFunction() { cloudCalls += 1; throw new Error('Cloud unavailable during startup'); }
      }
    }
  });
  // Native mini-program packages register JavaScript modules, not Node's JSON loader.
  function load(specifier, parent = path.join(root, 'entry.js')) {
    assert.ok(specifier.startsWith('.'), `Unexpected package import: ${specifier}`);
    const resolved = path.resolve(path.dirname(parent), specifier);
    const file = resolved.endsWith('.js') ? resolved : `${resolved}.js`;
    assert.ok(file.startsWith(root + path.sep), `Import outside mini-program: ${specifier}`);
    if (file === path.join(root, 'config.js')) return { mode, envId: mode === 'cloud' ? 'test-environment' : '' };
    if (modules.has(file)) return modules.get(file).exports;
    assert.ok(fs.existsSync(file), `Missing native JavaScript module: ${path.relative(root, file)}`);
    const module = { exports: {} };
    modules.set(file, module);
    const run = vm.runInContext(`(function(require, module, exports) {\n${fs.readFileSync(file, 'utf8')}\n})`, context, { filename: file });
    run((target) => load(target, file), module, module.exports);
    return module.exports;
  }
  load('./app');
  app.onLaunch();
  app.onShow();
  function loadPage(name) {
    page = null;
    load(`./pages/${name}/index`);
    assert.ok(page, `${name} did not register`);
    const configPath = path.join(root, `pages/${name}/index.json`);
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    for (const component of Object.values(config.usingComponents || {})) load(`.${component}`);
    return { ...page, data: JSON.parse(JSON.stringify(page.data || {})),
      setData(patch) { Object.assign(this.data, JSON.parse(JSON.stringify(patch))); } };
  }
  return { app, loadPage, components, cloudCalls: () => cloudCalls };
}

test('native JavaScript loader starts the demo, registers every page and creates daily tasks without cloud access', async () => {
  const runtime = nativeRuntime('demo');
  const names = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).pages.map((entry) => entry.split('/')[1]);
  const pages = Object.fromEntries(names.map((name) => [name, runtime.loadPage(name)]));
  const { today, family } = pages;
  today.onShow();
  family.onShow();
  try {
    assert.equal(today.data.family, null, 'the initial screen renders before bootstrap finishes');
    await runtime.app.engine.sync();
    assert.equal(today.data.family.children[0].schoolGrade, 1);
    assert.equal(today.data.family.children[0].age, 6);
    assert.equal(today.data.family.members[0].name, '我');
    assert.ok(today.data.allTaskCount > 0);
    assert.ok(today.data.groups.length > 0);
    assert.equal(runtime.components.length, 1, 'all learning lists register the same native card component');
    assert.equal(runtime.app.engine.snapshot().status, 'online');
    assert.equal(runtime.cloudCalls(), 0);
  } finally { today.cleanup(); family.cleanup(); }
});

test('a cloud connection failure leaves the initial screen available with a connection error', async () => {
  const runtime = nativeRuntime('cloud');
  const today = runtime.loadPage('today');
  today.onShow();
  try {
    assert.equal(today.data.mode, 'cloud');
    assert.equal(today.data.family, null);
    await runtime.app.engine.sync();
    assert.equal(runtime.app.engine.snapshot().status, 'offline');
    assert.match(today.data.syncError, /Cloud unavailable/);
    assert.ok(runtime.cloudCalls() > 0);
  } finally { today.cleanup(); }
});
