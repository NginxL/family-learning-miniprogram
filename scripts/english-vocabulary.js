'use strict';
const foundation = require('../data/catalogs/english-foundation-meanings.json').entries;
const compact = value => value.replace(/\s/g, '');
const unique = values => [...new Map(values.filter(Boolean).map(value => [compact(value), value])).values()];

// Common senses are independent of a book occurrence. Never let the first unit replace them.
// These additions recover common meanings lost by the previous first-occurrence overwrite.
const restored = require('../data/catalogs/english-common-sense-repairs.json').entries;
const reviewed = { ...require('../data/catalogs/english-dictionary-senses.json').entries,
  ...require('../data/catalogs/english-high-frequency-senses.json').entries };

// A semicolon inside a qualifier belongs to that sense, not to the next one.
function splitMeanings(text) {
  let depth = 0, start = 0; const parts = [];
  for (let i = 0; i < text.length; i++) {
    if ('（('.includes(text[i])) depth++;
    else if ('）)'.includes(text[i])) depth = Math.max(0, depth - 1);
    else if (text[i] === '；' && !depth) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  return [...parts, text.slice(start)].map(s => s.trim()).filter(Boolean);
}
const bareMeaning = meaning => compact(meaning.replace(/[（(][^（）()]*[）)]/g, ''));
function coversMeaning(existing, wanted) {
  return compact(existing) === compact(wanted)
    || (compact(wanted) === bareMeaning(wanted) && bareMeaning(existing) === compact(wanted));
}
function mergeMeanings(values) {
  const exact = unique(values);
  return exact.filter(value => !exact.some(other => other !== value
    && compact(value) === bareMeaning(value) && bareMeaning(other) === compact(value)));
}

// Exact sense matching only: a noun meaning must never hide a verb/adjective meaning.
function senseRows(text) {
  return text.split('\n').flatMap(line => {
    const match = line.match(/^(?:[^·\n]+ · )?((?:n\.|v\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.|短语)(?:\s*&\s*(?:n\.|v\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.))*) (.+)$/);
    return match ? match[1].split(/\s*&\s*/).flatMap(pos => splitMeanings(match[2]).map(meaning => ({ pos, meaning }))) : [];
  });
}
function hasSense(text, pos, meaning) {
  const rows = senseRows(text);
  return splitMeanings(meaning).every(part => rows.some(row => row.pos === pos && coversMeaning(row.meaning, part)));
}
function commonText(typed, untyped) {
  const groups = new Map();
  for (const row of senseRows(typed.join('\n'))) {
    const values = groups.get(row.pos) || [];
    groups.set(row.pos, mergeMeanings([...values, row.meaning]));
  }
  const covered = new Set([...groups.values()].flat().map(compact));
  const remaining = unique(untyped.flatMap(splitMeanings)).filter(value => !covered.has(compact(value))
    && ![...groups.values()].flat().some(meaning => coversMeaning(meaning, value)));
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
  // A verified occurrence supersedes its authored hint; other unverified units remain explicit.
  if (!word.textbookSenses?.length) entry.hints.push(word.meaning);
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
    const textbookGroups = new Map();
    for (const sense of entry.textbook) {
      for (const pos of sense.partOfSpeech?.split(/\s*&\s*/) || [null]) {
        const label = `${sense.form !== item.title ? sense.form + ' · ' : ''}${pos || '表达'}`;
        const remaining = splitMeanings(sense.meaning).filter(meaning => !pos || !hasSense(common, pos, meaning));
        textbookGroups.set(label, mergeMeanings([...(textbookGroups.get(label) || []), ...remaining]));
      }
    }
    const textbook = [...textbookGroups].filter(([, meanings]) => meanings.length)
      .map(([label, meanings]) => `${label} ${meanings.join('；')}`);
    const blocks = [];
    if (common) blocks.push(`常用义：\n${common}`);
    if (textbook.length) blocks.push(`教材用法：\n${textbook.join('\n')}`);
    const knownMeanings = new Set([
      ...senseRows(common).map(row => row.meaning),
      ...common.split('\n').filter(line => !senseRows(line).length).flatMap(splitMeanings),
      ...entry.textbook.flatMap(sense => splitMeanings(sense.meaning))
    ].map(compact));
    const hints = unique(entry.hints.flatMap(splitMeanings))
      .filter(hint => !knownMeanings.has(compact(hint)));
    if (hints.length) blocks.push(`单元学习提示（自编，原页义项待核实）：\n${hints.join('；')}`);
    const hiddenForms = unique([...entry.forms, ...entry.textbook.map(s => s.form)])
      .filter(form => form !== item.title && !textbook.some(line => line.startsWith(form + ' · ')));
    if (hiddenForms.length) blocks.push(`教材写法：${hiddenForms.join('；')}`);
    item.detail = [item.title, ...blocks].join('\n\n');
    item.source = `${item.source.split('；')[0]}；常用义独立整理；教材词性与单元义见册次来源`;
    item.note = '常用义独立于教材单元义；重复义项合并显示，单元原文保留在册次依据。教材用法中的词性照原书，“表达”表示原书未标词性。无原页的单元提示是自编学习辅助；不是完整词典或中考词汇范围。';
    if (review) item.commonSenseSources = review.sources;
    item.vocabularyRevision = '2026-10-19';
  }
  return items;
}
module.exports = { collect, finish, hasSense, splitMeanings, commonText };
