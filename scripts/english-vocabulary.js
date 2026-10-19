'use strict';
const foundation = require('../data/catalogs/english-foundation-meanings.json').entries;
const compact = value => value.replace(/\s/g, '');
const unique = values => [...new Map(values.filter(Boolean).map(value => [compact(value), value])).values()];

// Common senses are independent of a book occurrence. Never let the first unit replace them.
// These additions recover common meanings lost by the previous first-occurrence overwrite.
const restored = require('../data/catalogs/english-common-sense-repairs.json').entries;
const reviewed = require('../data/catalogs/english-high-frequency-senses.json').entries;

// Exact sense matching only: a noun meaning must never hide a verb/adjective meaning.
function senseRows(text) {
  return text.split('\n').flatMap(line => {
    const match = line.match(/^(?:[^·\n]+ · )?((?:n\.|v\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.|短语)(?:\s*&\s*(?:n\.|v\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.))*) (.+)$/);
    return match ? match[1].split(/\s*&\s*/).flatMap(pos => match[2].split('；').map(meaning => ({ pos, meaning }))) : [];
  });
}
function hasSense(text, pos, meaning) {
  const rows = senseRows(text);
  return meaning.split('；').every(part => rows.some(row => row.pos === pos && compact(row.meaning) === compact(part)));
}
function commonText(typed, untyped) {
  const groups = new Map();
  for (const row of senseRows(typed.join('\n'))) {
    const values = groups.get(row.pos) || [];
    groups.set(row.pos, unique([...values, row.meaning]));
  }
  const covered = new Set([...groups.values()].flat().map(compact));
  const remaining = unique(untyped.flatMap(value => value.split('；'))).filter(value => !covered.has(compact(value)));
  return [...groups].map(([pos, values]) => `${pos} ${values.join('；')}`)
    .concat(remaining.length ? [remaining.join('；')] : []).join('\n');
}

function collect(item, word, state) {
  let entry = state.get(item.id);
  if (!entry) {
    const base = item.detail.startsWith(item.title + '\n') ? item.detail.slice(item.title.length + 1)
      : item.detail.startsWith(item.title + ' · ') ? item.detail.slice(item.title.length + 3) : '';
    // Unreviewed dictionary senses remain available in sources, never relabelled as textbook meanings.
    const generic = item.note?.includes('通用词典参考');
    if (generic) item.dictionaryReference = base;
    // New book words are created with the unit hint as their detail. That is not a common sense.
    entry = { common: item.collections.includes('tables') ? [base] : [], textbook: [], hints: [], forms: [] };
    state.set(item.id, entry);
  }
  if (word.textbookSenses) {
    for (const sense of word.textbookSenses) entry.textbook.push({ ...sense, form: word.textbookForm || word.text });
  }
  // Keep earlier authored hints available, but never present them as common or printed senses.
  entry.hints.push(word.meaning);
  if (word.textbookForm) entry.forms.push(word.textbookForm);
  // Foundations use canonical aliases (e.g. colour/color); keep every existing common sense.
  for (const alias of item.aliases || []) if (foundation[alias]) entry.common.push(foundation[alias]);
}

function finish(items, state) {
  for (const item of items.filter(item => item.kind === 'word')) {
    const heads = [item.title, ...(item.aliases || [])];
    const review = heads.map(head => reviewed[head]).find(Boolean);
    if (!state.has(item.id) && !review) continue;
    const entry = state.get(item.id) || { common: heads.map(head => foundation[head]).filter(Boolean), textbook: [], hints: [], forms: [] };
    if (!state.has(item.id) && item.note?.includes('通用词典参考')) item.dictionaryReference = item.detail.slice(item.title.length + 1);
    const common = commonText([review?.meaning, ...heads.map(head => restored[head])].filter(Boolean), entry.common);
    const textbook = unique(entry.textbook.filter(sense =>
      // A differing printed form remains visible even when its meaning is already on the card.
      sense.form !== item.title || !sense.partOfSpeech || !hasSense(common, sense.partOfSpeech, sense.meaning)
      || !common.includes(sense.meaning)).map(sense =>
      `${sense.form !== item.title ? sense.form + ' · ' : ''}${sense.partOfSpeech || '表达'} ${sense.meaning}`));
    const blocks = [];
    if (common) blocks.push(`常用义：\n${common}`);
    if (textbook.length) blocks.push(`教材用法：\n${textbook.join('\n')}`);
    const hints = unique(entry.hints).filter(hint => ![common, ...textbook].some(text => text.includes(hint)));
    if (hints.length) blocks.push(`单元学习提示（自编，原页义项待核实）：\n${hints.join('；')}`);
    if (entry.forms.length && !textbook.length) blocks.push(`教材写法：${unique(entry.forms).join('；')}`);
    item.detail = [item.title, ...blocks].join('\n\n');
    item.source = `${item.source.split('；')[0]}；常用义独立整理；教材词性与单元义见册次来源`;
    item.note = '常用义独立于教材单元义；重复义项合并显示，单元原文保留在册次依据。教材用法中的词性照原书，“表达”表示原书未标词性。无原页的单元提示是自编学习辅助；不是完整词典或中考词汇范围。';
    if (review) item.commonSenseSources = review.sources;
    item.vocabularyRevision = '2026-10-19';
  }
  return items;
}
module.exports = { collect, finish, hasSense };
