'use strict';
const classical = require('../data/catalogs/chinese-classical-details.json');
const english = require('../data/catalogs/english-word-study.json');
const compact = text => text.replace(/[\s，。；、！？：“”‘’]/g, '');

// Display-only additions: original content IDs, bodies and persisted task snapshots stay intact.
function augment(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const used = new Set();
  const attach = (id, kind, notes) => {
    const item = byId.get(id);
    if (!item || item.kind !== kind || used.has(id)) throw Error(`Invalid study-note target: ${id}`);
    used.add(id);
    item.studyNotes = notes;
  };
  for (const entry of classical.entries) {
    const item = byId.get(entry.contentId);
    if (!item || entry.words.length < 5 || entry.sentences.length < 2 || !entry.structure || !entry.pitfall
      || entry.sentences.some(sentence => !compact(item.detail).includes(compact(sentence.text))))
      throw Error(`Unverified classical note: ${entry.contentId}`);
    attach(entry.contentId, 'poetry', {
      title: '字词、句意与理解',
      notice: '依据本页原作自编；句意为自译，练习为自编。不是教材注释或完整考点，背诵范围见原书要求。',
      sections: [
        { title: '字词放回原句', body: entry.words.map(word => `${word.text}：${word.meaning}`).join('\n') },
        { title: '重点句意', body: entry.sentences.map(sentence => `${sentence.text}\n${sentence.meaning}`).join('\n\n') },
        { title: '篇章理解', body: entry.structure },
        { title: '容易混淆', body: entry.pitfall }
      ],
      exercises: entry.exercises.map(exercise => ({ ...exercise })),
      sources: [{ title: '原作依据', url: item.textSourceUrl || item.referenceUrl }],
      searchTerms: entry.words.map(word => word.text)
    });
  }
  for (const entry of english.entries) {
    const item = byId.get(entry.contentId);
    if (![item?.title, ...(item?.aliases || [])].includes(entry.lemma)) throw Error(`Word-note headword mismatch: ${entry.contentId}`);
    if (!entry.forms.length && !entry.patterns.length && !entry.families.length) throw Error(`Empty word note: ${entry.contentId}`);
    const sections = [];
    if (entry.forms.length) sections.push({ title: '常用词形', body: entry.forms.map(form => `${form.label}：${form.value}`).join('\n') });
    if (entry.patterns.length) sections.push({ title: '短语与搭配', body: entry.patterns.map(pattern =>
      `${pattern.pattern} · ${pattern.meaning}\n${pattern.example}\n${pattern.translation}\n${pattern.note}`).join('\n\n') });
    if (entry.families.length) sections.push({ title: '词族联系', body: entry.families.map(family => `${family.words}\n${family.note}`).join('\n\n') });
    if (entry.pitfalls.length) sections.push({ title: '容易混淆', body: entry.pitfalls.join('\n') });
    const form = entry.forms.find(form => form.label === '动词过去式') || entry.forms[0];
    const pattern = entry.patterns[0];
    const exercises = [form ? { question: `回忆 ${entry.lemma} 的${form.label}。`, answer: `${form.value}${entry.pitfalls.length ? `。提示：${entry.pitfalls[0]}` : ''}` }
      : { question: `用自己的话解释 ${pattern?.pattern || entry.lemma} 的用法，并造一个句子。`,
        answer: pattern ? `参考：${pattern.meaning}。${pattern.note}\n自编例句：${pattern.example}\n${pattern.translation}` : entry.families.map(f => `${f.words}\n${f.note}`).join('\n') }];
    if (pattern && form) exercises.push({ question: `说明 ${pattern.pattern} 的含义，并用它造句。`,
      answer: `参考：${pattern.meaning}。${pattern.note}\n自编例句：${pattern.example}\n${pattern.translation}` });
    attach(entry.contentId, 'word', { title: '词形、短语与词族',
      notice: '常用用法与自编例句。下方教材归属只针对原词条，不代表这些拓展用法都出自该册；不是完整中考词汇清单。',
      sections, exercises,
      sources: entry.sourceIds.map(id => { if (!english.sources[id]) throw Error(`Unknown reference: ${id}`); return { ...english.sources[id] }; }),
      searchTerms: [entry.lemma, ...entry.forms.map(form => form.value), ...entry.patterns.map(pattern => pattern.pattern), ...entry.families.map(family => family.words)]
    });
  }
  return items;
}
module.exports = { augment, counts: { classicalGuides: classical.entries.length, wordGuides: english.entries.length,
  phrasePatterns: english.entries.reduce((n, e) => n + e.patterns.length, 0), wordFamilies: english.entries.reduce((n, e) => n + e.families.length, 0) } };
