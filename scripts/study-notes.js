'use strict';
const classical = require('../data/catalogs/chinese-classical-details.json');
const classicalSupplements = require('../data/catalogs/chinese-classical-supplements.json');
const english = require('../data/catalogs/english-word-study.json');
const structures = require('../data/catalogs/english-structure-supplements.json');
const { hasSense } = require('./english-vocabulary');
const compact = text => text.replace(/[\s，。；、！？：“”‘’]/g, '');

// Display-only additions: no guide metadata is written into persisted task snapshots.
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
    const supplement = classicalSupplements.entries.find(row => row.contentId === entry.contentId);
    if (!supplement) throw Error(`Missing classical supplement: ${entry.contentId}`);
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
        { title: '容易混淆', body: entry.pitfall },
        { title: '课后字词与用法', body: supplement.words.map(word => `${word.text}：${word.meaning}`).join('\n') },
        { title: '文化与阅读提示', body: supplement.culture }
      ],
      exercises: [...entry.exercises, ...supplement.exercises].map(exercise => ({ ...exercise })),
      sources: [{ title: '原作依据', url: item.textSourceUrl || item.referenceUrl },
        ...(entry.textbookEvidence || []).map(page => ({ title: `讲解核验原书第${page.sourcePrintPage}页 / 电子第${page.sourcePdfPage}页`, url: page.sourceUrl })),
        { title: supplement.pages.length ? `补充学习依据 · 原书第${supplement.pages.map(p => p.sourcePrintPage).join('、')}页` : '补充学习原作依据（教材册次待核实）', url: supplement.sourceUrl }],
      searchTerms: [...entry.words, ...supplement.words].map(word => word.text)
    });
  }
  for (const entry of english.entries) {
    const item = byId.get(entry.contentId);
    if (![item?.title, ...(item?.aliases || [])].includes(entry.lemma)) throw Error(`Word-note headword mismatch: ${entry.contentId}`);
    if (!entry.forms.length && !entry.patterns.length && !entry.families.length) throw Error(`Empty word note: ${entry.contentId}`);
    const missingSenses = new Set();
    for (const form of entry.forms) {
      if (!form.sense?.partOfSpeech || !form.sense.meaning) throw Error(`Unbound inflection: ${entry.contentId}/${form.label}`);
      const sense = `${form.sense.partOfSpeech} ${form.sense.meaning}`;
      if (!item.detail.includes(sense) && !hasSense(item.detail, form.sense.partOfSpeech, form.sense.meaning)) missingSenses.add(sense);
    }
    if (missingSenses.size) item.detail += `\n\n词形对应义：\n${[...missingSenses].join('\n')}`;
    if (entry.forms.length) item.vocabularyRevision = '2026-10-19';
    const sections = [];
    if (entry.forms.length) sections.push({ title: '常用词形', body: entry.forms.map(form => `${form.sense.partOfSpeech} ${form.sense.meaning}\n${form.label}：${form.value}`).join('\n\n') });
    if (entry.patterns.length) sections.push({ title: '短语与搭配', body: entry.patterns.map(pattern =>
      `${pattern.pattern} · ${pattern.meaning}\n${pattern.example}\n${pattern.translation}\n${pattern.note}`).join('\n\n') });
    if (entry.families.length) sections.push({ title: '词族联系', body: entry.families.map(family => `${family.words}\n${family.note}`).join('\n\n') });
    if (entry.pitfalls.length) sections.push({ title: '容易混淆', body: entry.pitfalls.join('\n') });
    const form = entry.forms.find(form => form.label === '动词过去式') || entry.forms[0];
    const pattern = entry.patterns[0];
    const formWord = form ? `${entry.lemma}「${form.sense.meaning}」` : entry.lemma;
    const openAnswer = form && /表达/.test(form.label);
    const exercises = [form ? { question: openAnswer ? `用 ${formWord} 写出一个${form.label}。` : `回忆 ${formWord}的${form.label}。`, answer: `${openAnswer ? '示例（其他符合此义的正确表达也可）：' : ''}${form.value}${entry.pitfalls.length ? `。提示：${entry.pitfalls[0]}` : ''}` }
      : { question: pattern ? `用自己的话解释 ${pattern.pattern} 的用法，并造一个句子。` : `写出 ${entry.lemma} 的相关词族及词性，说明它们之间的联系。`,
        answer: pattern ? `参考：${pattern.meaning}。${pattern.note}\n自编例句：${pattern.example}\n${pattern.translation}` : entry.families.map(f => `${f.words}\n${f.note}`).join('\n') }];
    if (pattern && form) exercises.push({ question: `说明 ${pattern.pattern} 的含义，并用它造句。`,
      answer: `参考：${pattern.meaning}。${pattern.note}\n自编例句：${pattern.example}\n${pattern.translation}` });
    attach(entry.contentId, 'word', { title: '词形、短语与词族',
      notice: '常用用法与自编例句。词卡的教材归属只针对原词条，不代表这些拓展用法都出自该册；不是完整中考词汇清单。',
      sections, exercises,
      sources: entry.sourceIds.map(id => { if (!english.sources[id]) throw Error(`Unknown reference: ${id}`); return { ...english.sources[id] }; }),
      searchTerms: [entry.lemma, ...entry.forms.map(form => form.value), ...entry.patterns.map(pattern => pattern.pattern), ...entry.families.map(family => family.words)]
    });
  }
  for (const entry of structures.entries) {
    const item = byId.get(entry.contentId);
    if (item?.kind !== 'word' || ![item.title, ...(item.aliases || [])].includes(entry.lemma)) throw Error(`Invalid structure target: ${entry.contentId}`);
    item.studyNotes ||= { title: '句型与搭配', notice: '跨年级用法补充，例句与练习自编；词卡所在册次不代表这些用法都出自该册，不是完整中考范围。', sections: [], exercises: [], sources: [], searchTerms: [] };
    item.studyNotes.sections.push({ title: '句型与用法补充', body: `${entry.pattern}\n${entry.meaning}\n${entry.example}\n${entry.translation}\n${entry.note}` });
    item.studyNotes.exercises.push({ ...entry.exercise });
    item.studyNotes.sources.push(...entry.sources.filter(source => !item.studyNotes.sources.some(existing => existing.url === source.url)));
    item.studyNotes.searchTerms.push(entry.pattern);
  }
  return items;
}
module.exports = { augment, counts: { classicalGuides: classical.entries.length,
  wordGuides: new Set([...english.entries, ...structures.entries].map(entry => entry.contentId)).size,
  phrasePatterns: english.entries.reduce((n, e) => n + e.patterns.length, 0) + structures.entries.length,
  wordFamilies: english.entries.reduce((n, e) => n + e.families.length, 0) } };
