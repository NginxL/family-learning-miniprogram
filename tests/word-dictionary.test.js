const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const learning = require('../shared/learning');
const { wordEntry } = require('../miniprogram/lib/word-entry');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const { decorate } = require('../miniprogram/lib/page');
const sounds = require('../data/catalogs/english-pronunciations.json');
const proof = require('../data/catalogs/english-pronunciation-evidence.json');
const overrides = require('../data/catalogs/english-pronunciation-overrides.json');
const core = require('../data/catalogs/english-dictionary-core.json');
const coreProof = require('../data/catalogs/english-dictionary-core-evidence.json');
const basic = require('../data/catalogs/english-dictionary-basic-pos.json');
const basicProof = require('../data/catalogs/english-dictionary-basic-pos-evidence.json');
const words = learning.catalog.filter(item => item.kind === 'word');
const word = head => words.find(item => item.title.split(' (')[0] === head);
const entry = head => wordEntry(word(head), word(head));
const groups = view => view.sections.flatMap(section => section.groups);
const senses = (view, pos) => groups(view).filter(group => group.pos === pos).flatMap(group => group.senses);
const hash = text => createHash('sha256').update(text).digest('hex');

test('dictionary presentation leaves every shared content ID, text, placement and history input unchanged', () => {
  // Full 426edf0 catalogue, not just the IDs: cloud/old clients receive the exact same knowledge.
  assert.equal(hash(JSON.stringify(learning.catalog)), '5038db8ff49c78fb294d3861ccc4cb1007c6766f3655e50d28d59fc03f230edd');
  for (const item of words) {
    const before = JSON.stringify(item);
    const view = withContentSources(decorate(item));
    assert.ok(view.wordEntry);
    assert.equal(view.detail, item.detail);
    assert.equal(JSON.stringify(item), before);
    assert.equal(view.textCorrectionNotice, '');
  }
});

test('all starter words show sourced pronunciation and POS; distinct noun/verb senses stay separate', () => {
  assert.equal(Object.keys(core.entries).length, 60);
  for (const head of Object.keys(core.entries)) {
    const view = entry(head);
    assert.ok(view.pronunciations.length, head);
    assert.ok(groups(view).some(group => group.pos), head);
    for (const sense of core.entries[head].senses) {
      const evidence = coreProof.entries[head].find(row => row.meaning === sense.meaning && row.pos === sense.pos);
      assert.ok(evidence, head + ': ' + sense.meaning);
    }
  }
  assert.ok(senses(entry('book'), 'n.').includes('书'));
  assert.ok(senses(entry('book'), 'v.').includes('预订'));
  assert.ok(senses(entry('fish'), 'n.').includes('鱼肉'));
  assert.ok(senses(entry('fish'), 'v.').includes('钓鱼'));
  assert.ok(senses(entry('I'), 'pron.').includes('我'));
  assert.ok(!senses(entry('I'), 'n.').includes('我'));
});

test('licensed pronunciation extraction is backed by exact source entries, with no phrase synthesis', () => {
  for (const [id, pronunciations] of Object.entries(sounds.entries)) {
    assert.ok(learning.catalogById.has(id), id);
    for (const p of pronunciations) {
      assert.ok(p.ipa && !/[\r\n,]/.test(p.ipa), id);
      const rows = proof.entries[id].filter(row => row.headword === p.headword);
      if (p.sourceId === 'ipa-us') {
        const row = rows.find(row => row.sourceKey);
        assert.equal(row.sourceKey, p.headword.toUpperCase());
        assert.equal(row.rowSha256, hash(row.sourceKey + '\t' + row.raw));
        assert.equal(p.ipa, row.raw.split(', ')[0]);
        assert.equal(p.accent, 'US');
      } else {
        const region = p.accent === 'UK' ? 'GB' : '';
        assert.ok(rows.some(row => row.pronunciations?.some(([accent, ipa]) => accent === region && ipa === p.ipa)), id);
      }
    }
  }
  assert.ok(entry('run').pronunciations.some(p => p.ipa.includes('ʌ')));
  assert.ok(!entry('run').pronunciations.some(p => p.ipa.includes('ə')));
  assert.ok(entry('good').pronunciations.every(p => !p.ipa.includes('gɪd')));
  assert.equal(entry('IT').pronunciationPending, true);
  assert.equal(entry('IT').pronunciations.length, 0); // Never borrow the pronoun it.
});

test('reviewed heteronyms explain which pronunciation applies, and sources remain available', () => {
  for (const head of ['read', 'live', 'close', 'wind', 'lead', 'record']) {
    const view = entry(head);
    assert.equal(view.pronunciations.length, 2, head);
    assert.ok(view.pronunciations.every(p => p.usage), head);
    assert.notEqual(view.pronunciations[0].ipa, view.pronunciations[1].ipa);
    assert.ok(view.sources.some(source => source.url.startsWith('https://www.collinsdictionary.com/')));
  }
  assert.match(entry('read').pronunciations.find(p => p.usage.includes('过去式')).ipa, /rɛd/);
  for (const [id, override] of Object.entries(overrides.entries)) {
    assert.ok(learning.catalogById.has(id));
    assert.ok(override.source.url.startsWith('https://'));
    assert.ok(override.pronunciations.length);
  }
});

test('basic POS follows reviewed dictionary evidence instead of assigning one POS to an entire Chinese line', () => {
  for (const [head, supplement] of Object.entries(basic.entries)) {
    assert.ok(basicProof.entries[head]?.translation, head);
    for (const row of supplement.senses) assert.ok(row.pos && row.meaning, head);
  }
  assert.deepEqual(senses(entry('glue'), 'n.'), ['胶水']);
  assert.deepEqual(senses(entry('glue'), 'v.'), ['粘贴']);
  assert.ok(!senses(entry('top'), 'n.').includes('最上面的'));
  assert.ok(senses(entry('top'), 'adj.').includes('最上面的'));
  assert.ok(senses(entry('over'), 'adv.').includes('结束'));
  assert.ok(!senses(entry('over'), 'prep.').includes('结束'));
});

test('custom words retain supplied meanings without silently borrowing public pronunciations or POS', () => {
  const custom = { id: 'custom-word', kind: 'word', title: 'book', detail: '我的自定义词义；（括号内；不拆开）' };
  const view = withContentSources(custom).wordEntry;
  assert.equal(view.pronunciationPending, true);
  assert.equal(view.sources.length, 0);
  assert.deepEqual(groups(view).map(group => group.pos), ['']);
  assert.deepEqual(groups(view)[0].senses, ['我的自定义词义', '（括号内；不拆开）']);
  assert.equal(wordEntry({ kind: 'poetry', title: '诗', detail: '正文' }), null);
});

test('dictionary grouping deduplicates only the same POS and meaning, retaining textbook variants and untyped glosses', () => {
  const custom = { id: 'custom-groups', kind: 'word', title: 'test', detail: 'test\n常用义：\nn. 测试\nv. 测试\n教材用法：\nn. 测试\nv. 测验\n其他原始含义\n自编例句：We test it.' };
  const view = wordEntry(custom);
  assert.deepEqual(senses(view, 'n.'), ['测试']);
  assert.deepEqual(senses(view, 'v.'), ['测试', '测验']);
  assert.ok(groups(view).some(group => !group.pos && group.senses.includes('其他原始含义')));
  assert.deepEqual(view.examples, ['We test it.']);
});

test('completed old tasks get a current reference plus exact old text without changing completion, mastery or queue payload', () => {
  const task = { ...learning.taskFrom(word('book'), 'child', 'old-task', 'manual'), detail: 'book · 书', done: true };
  const ledger = { records: {} }; learning.recordTasks(ledger, [task], '2026-10-21');
  ledger.records[task.contentId].mastered = true;
  const before = JSON.stringify({ task, ledger });
  const view = withContentSources(decorate(task));
  assert.equal(view.wordEntry.legacyText, task.detail);
  assert.equal(view.detail, task.detail);
  assert.ok(senses(view.wordEntry, 'v.').includes('预订'));
  assert.match(view.textCorrectionNotice, /学习记录不变/);
  assert.equal(JSON.stringify({ task, ledger }), before);
});

test('card summaries and both detail routes share the dictionary view without hiding playback or schedule controls', () => {
  const card = decorate(word('book'));
  assert.match(card.phoneticBrief, /bʊk/);
  assert.match(card.wordBrief, /n\. 书/);
  assert.match(card.wordBrief, /v\. 预订/);
  for (const page of ['content', 'study']) {
    const template = fs.readFileSync(`miniprogram/pages/${page}/index.wxml`, 'utf8');
    assert.match(template, /wordPronunciation/);
    assert.match(template, /wordDefinitions/);
    assert.match(template, /<speech-button/);
  }
  assert.match(fs.readFileSync('miniprogram/pages/content/index.wxml', 'utf8'), /arrangeContent/);
  assert.match(fs.readFileSync('miniprogram/THIRD_PARTY_NOTICES.txt', 'utf8'), /CMU Pronouncing Dictionary 0\.7b/);
});
