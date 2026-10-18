'use strict';
const foundation = require('../data/catalogs/english-foundation-meanings.json').entries;
const compact = value => value.replace(/\s/g, '');
const unique = values => [...new Map(values.filter(Boolean).map(value => [compact(value), value])).values()];

// Common senses are independent of a book occurrence. Never let the first unit replace them.
// These additions recover common meanings lost by the previous first-occurrence overwrite.
const restored = require('../data/catalogs/english-common-sense-repairs.json').entries;

function collect(item, word, state) {
  let entry = state.get(item.id);
  if (!entry) {
    const base = item.detail.startsWith(item.title + '\n') ? item.detail.slice(item.title.length + 1)
      : item.detail.startsWith(item.title + ' · ') ? item.detail.slice(item.title.length + 3) : '';
    // Unreviewed dictionary senses remain available in sources, never relabelled as textbook meanings.
    const generic = item.note?.includes('通用词典参考');
    if (generic) item.dictionaryReference = base;
    entry = { common: generic ? [] : [base], textbook: [], forms: [] };
    state.set(item.id, entry);
  }
  if (word.textbookSenses) {
    for (const sense of word.textbookSenses) entry.textbook.push({ ...sense, form: word.textbookForm || word.text });
  }
  entry.common.push(word.meaning);
  if (word.textbookForm) entry.forms.push(word.textbookForm);
  // Foundations use canonical aliases (e.g. colour/color); keep every existing common sense.
  for (const alias of item.aliases || []) if (foundation[alias]) entry.common.push(foundation[alias]);
}

function finish(items, state) {
  for (const item of items.filter(item => state.has(item.id))) {
    const entry = state.get(item.id);
    const common = unique(entry.common.flatMap(value => value.split('；'))).join('；');
    const textbook = unique(entry.textbook.map(sense =>
      `${sense.form !== item.title ? sense.form + ' · ' : ''}${sense.partOfSpeech || '表达'} ${sense.meaning}`));
    const extra = unique([restored[item.aliases?.[0] || item.title]]);
    const blocks = [];
    if (state.has(item.id)) {
      if (common) blocks.push(`常用义：${common}`);
      if (textbook.length) blocks.push(`教材用法：\n${textbook.join('\n')}`);
      if (entry.forms.length && !textbook.length) blocks.push(`教材写法：${unique(entry.forms).join('；')}`);
      item.detail = [item.title, ...blocks].join('\n\n');
      item.source = `${item.source.split('；')[0]}；常用义合并；教材词性与单元义见册次来源`;
      item.note = '常用义与教材单元义分别保留；教材用法中的词性照原书，标“表达”的条目原书未标词性。音频与目录选词的纸本词性仍待核实；不是完整词典或中考词汇范围。';
    }
    const missing = extra.filter(sense => !item.detail.includes(sense));
    if (missing.length) item.detail += `\n\n常用补充：\n${missing.join('\n')}`;
    item.vocabularyRevision = '2026-10-18';
  }
  return items;
}
module.exports = { collect, finish };
