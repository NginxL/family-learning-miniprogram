const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const { pinyinEntries } = require('../miniprogram/lib/pinyin-data');
const lowerPinyin = require('../miniprogram/lib/lower-primary-pinyin');
const { pinyinFor, defaultPinyin } = require('../miniprogram/lib/pinyin');
const { fixture } = require('./helpers');
const textOf = (lines) => lines.map(line => line.map(token => (token.before || '') + token.text + (token.after || '')).join('')).join('\n');
function page(name, engine) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${name}/index`); delete require.cache[file]; require(file);
  return { ...definition, engine, active: true, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}

test('reading aids exactly retain source punctuation and line breaks, and cover every verified first/second-grade poem', () => {
  assert.equal(Object.keys(pinyinEntries).length, 21);
  assert.equal(Object.keys(lowerPinyin).length, 55);
  for (const [id, entry] of Object.entries({ ...pinyinEntries, ...lowerPinyin })) {
    const item = learning.catalogById.get(id); assert.ok(item, id);
    assert.equal(entry.title, item.title); assert.equal(entry.detail, item.detail);
    for (const [text, reading] of [[entry.title, entry.titleReading], [entry.detail, entry.detailReading]]) {
      const syllables = reading.split(' ');
      assert.equal(syllables.length, (text.match(/[\u3400-\u9fff]/g) || []).length, id);
      assert.ok(syllables.every(s => /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/.test(s)), id);
    }
    const aid = pinyinFor(item); assert.ok(aid, id);
    assert.equal(textOf(aid.title), item.title);
    assert.equal(textOf(aid.body), item.author && item.detail.startsWith(`${item.author}\n`) ? item.detail.slice(item.author.length + 1) : item.detail);
  }
  for (const item of learning.catalog.filter(item => item.kind === 'reading' || item.kind === 'poetry' && item.gradeMappings?.some(mapping => mapping.grade <= 2))) assert.ok(pinyinFor(item), item.id);
  assert.equal(learning.searchCatalog({ grade: 2, semester: '下册' }).length, 0, 'unverified books stay empty');
  const poem = id => pinyinFor(learning.catalogById.get(id)).body.flat();
  assert.equal(poem('poem-goose').find(t => t.text === '曲').pinyin, 'qū');
  assert.equal(poem('poem-baidi').find(t => t.text === '还').pinyin, 'huán');
  assert.equal(poem('poem-baidi').find(t => t.text === '重').pinyin, 'chóng');
  assert.equal(poem('reading-seed').find(t => t.text === '种').pinyin, 'zhǒng');
  assert.equal(poem('reading-park').find(t => t.text === '会儿').pinyin, 'huìr');
  assert.ok(poem('reading-seed').some(t => t.after === '？'));
  assert.ok(poem('reading-seed').every(t => !/^[，。！？；：、）】》」』”’]$/.test(t.text)));
});

test('pinyin declines old changed snapshots, custom text and unsupported content without mutating task storage', () => {
  const source = learning.catalogById.get('poem-goose');
  const task = learning.taskFrom(source, 'child', 'task', 'new'); const before = structuredClone(task);
  assert.ok(pinyinFor(task)); assert.deepEqual(task, before);
  assert.equal(pinyinFor({ ...task, detail: task.detail + '\n家长的新提示' }), null);
  assert.equal(pinyinFor({ id: 'custom', title: source.title, kind: 'poetry', detail: '同名练习' }), null);
  assert.equal(pinyinFor({ ...task, title: '不同标题' }), null);
  assert.equal(pinyinFor(learning.catalogById.get('english-reading-red-bag')), null);
  for (const grade of [null, undefined, 3, 9]) assert.equal(defaultPinyin(grade), false);
  for (const grade of [1, 2]) assert.equal(defaultPinyin(grade), true);
});

test('built-in English reading works through templates, tomorrow deduplication, completion, sync and review', async () => {
  const f = fixture(); const family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id; const familyId = family.id;
  const readings = learning.searchCatalog({ kind: 'english-reading', scope: 'starter' });
  assert.equal(readings.length, 6); assert.ok(readings.every(item => !item.gradeMappings?.length && /自编/.test(item.source)));
  const rules = learning.emptyRules().map(rule => ({ ...rule, quantity: rule.kind === 'english-reading' || rule.kind === 'reading' ? 1 : 0 }));
  await f.call('parent-a', 'saveDailyTemplate', { familyId, childId, templateId: 'reading-template', name: '每天读一读', rules, activate: true, baseRevision: 0, mutationId: 'reading-template' });
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync('2026-10-12'); await b.engine.sync('2026-10-12');
  const today = a.engine.viewDay('2026-10-12').tasks; assert.equal(today.length, 2);
  const article = today.find(task => task.kind === 'english-reading');
  assert.equal(article.contentId, readings[0].id); assert.match(article.detail, /Read and think/);
  a.engine.enqueue('2026-10-12', article.id, true); await a.engine.sync('2026-10-12'); await b.engine.sync('2026-10-12');
  assert.equal(b.engine.viewDay('2026-10-12').tasks.find(task => task.id === article.id).done, true);
  await a.engine.sync('2026-10-13');
  assert.ok(a.engine.viewDay('2026-10-13').tasks.every(task => !today.some(old => old.contentId === task.contentId)));
  const history = await b.engine.getHistory({ childId, subject: 'english' });
  assert.equal(history.total, 1); assert.equal(history.items[0].id, article.contentId);
  assert.equal(history.items[0].mastered, false);
  const priorDay = structuredClone(a.engine.viewDay('2026-10-12'));
  await a.engine.command('saveDailyTemplate', { childId, templateId: 'reading-template', name: '每天读一读', rules: rules.map(rule => ({ ...rule, mode: 'review' })), activate: true, baseRevision: 1, mutationId: 'reading-review' });
  await a.engine.sync('2026-10-13');
  assert.equal(a.engine.viewDay('2026-10-13').tasks.find(task => task.kind === 'english-reading').contentId, article.contentId);
  assert.deepEqual(a.engine.viewDay('2026-10-12'), priorDay);
});

test('library and study show switchable pinyin for first/second grade with no learning or queue writes', async t => {
  const f = fixture(); const family = await f.family(); const childId = family.children[0].id;
  const child = family.children[0];
  await f.call('parent-a', 'updateChild', { familyId: family.id, childId, name: child.name, schoolGrade: 2, baseVersion: child.version || 0 });
  await f.call('parent-a', 'assignContent', { familyId: family.id, childId, contentId: 'reading-seed', date: '2026-10-12' });
  const { engine } = f.client('parent-a'); await engine.sync('2026-10-12');
  global.wx = { showToast() {} }; global.getApp = () => ({ engine, mode: 'cloud', navigation: {} });
  t.after(() => { delete global.wx; delete global.getApp; delete global.Page; });
  const library = page('library', engine); library.render();
  library.changeKind({ detail: { value: library.data.kinds.findIndex(kind => kind.id === 'reading') } });
  library.changeScope({ detail: { value: library.data.scopes.findIndex(scope => scope.id === 'starter') } });
  assert.equal(library.data.items.length, 6); assert.equal(library.data.showPinyin, true);
  assert.ok(library.data.items.every(item => item.pinyin && item.gradeLabel === '自编入门练习 · 非教材课文'));
  library.expandContent({ currentTarget: { dataset: { id: 'reading-seed' } } });
  const study = page('study', engine); study.onLoad({ familyId: family.id, childId, date: '2026-10-12', kind: 'reading' }); study.render();
  assert.equal(study.data.hasPinyin, true); assert.equal(study.data.showPinyin, true);
  const before = engine.snapshot();
  library.togglePinyin(); library.render(); study.togglePinyin(); study.render();
  assert.equal(library.data.showPinyin, false); assert.equal(study.data.showPinyin, false);
  assert.deepEqual(engine.snapshot(), before);
  engine.state.family.myRole = 'child'; study.render(); assert.equal(study.data.isChild, true); assert.equal(study.data.hasPinyin, true);
  study.togglePinyin(); assert.equal(study.data.showPinyin, true);
  library.changeKind({ detail: { value: library.data.kinds.findIndex(kind => kind.id === 'english-reading') } });
  assert.equal(library.data.items.length, 6); assert.ok(library.data.items.every(item => item.pinyin === null));
});
