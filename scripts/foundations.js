'use strict';
const reviewed = require('../data/catalogs/english-reviewed-meanings.json');
const recitations = require('../data/catalogs/chinese-recitation-requirements.json');
const chinese = require('../data/catalogs/chinese-foundation-system.json');
const english = require('../data/catalogs/english-foundation-system.json');
const studyNotes = require('./study-notes');
const { data } = require('./lower-primary');
const areaLabels = { recitation: '背诵与默写', classical: '文言理解', vocabulary: '词汇运用', grammar: '英语语法' };
const books = new Map(data.books.map(book => [book.id, book]));
const compact = value => value.replace(/\s/g, '');

function lessonDetail(lesson) {
  return `学习目标：${lesson.goal}\n\n${lesson.quote ? `原句：${lesson.quote}\n\n` : ''}知识说明：\n${lesson.explanation}`
    + (lesson.example ? `\n\n自编例句：\n${lesson.example}` : '')
    + `\n\n先练一练：\n${lesson.exercises.map((ex, i) => `${i + 1}. ${ex.question}`).join('\n')}`
    + `\n\n作答后核对：\n${lesson.exercises.map((ex, i) => `${i + 1}. ${ex.answer}`).join('\n')}`;
}

function augment(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  for (const entry of reviewed.entries) {
    const item = byId.get(entry.id);
    if (!item || item.kind !== 'word') throw Error(`Reviewed word no longer matches baseline: ${entry.id}`);
    // A newer dictionary review takes precedence, without removing its original example.
    if (item.commonSenseSources) {
      item.detail += `\n\n自编例句：${entry.example}\n${entry.translation}`;
      continue;
    }
    if (!item.note.includes('通用词典参考')) throw Error(`Reviewed word no longer matches baseline: ${entry.id}`);
    item.detail = `${item.title}\n${entry.meaning}\n\n自编例句：${entry.example}\n${entry.translation}`;
    item.source = `${item.source.split('；')[0]}；常用义、例句与中文提示自编`;
    item.note = '已整理常用义和语境例句；不是完整词典释义或教材译文。教材年级、学期待核实。';
    // Do not present a generic dictionary link as the source of an original teaching example.
    delete item.textSourceUrl;
  }
  for (const entry of recitations.entries) {
    const item = byId.get(entry.contentId), book = books.get(entry.bookId);
    const location = item?.gradeMappings?.find(mapping => mapping.bookId === entry.bookId);
    if (!book || !location || entry.sourceUrl !== location.sourceUrl || entry.sourcePdfPage - entry.sourcePrintPage !== location.sourcePdfPage - location.sourcePrintPage)
      throw Error(`Unmatched recitation source: ${entry.contentId}/${entry.bookId}`);
    if (entry.start && (!item.detail.includes(entry.start) || !item.detail.includes(entry.end))) throw Error(`Invalid excerpt boundary: ${entry.contentId}`);
    item.recitationRequirements = [...(item.recitationRequirements || []), { ...entry,
      label: `${book.grade}年级${book.semester}${book.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}：${entry.requirement}` }];
  }
  for (const lesson of [...chinese.lessons, ...english.lessons]) {
    if (byId.has(lesson.id) || !areaLabels[lesson.area] || lesson.exercises.length < 2
      || lesson.exercises.some(ex => !ex.question || !ex.answer)) throw Error(`Invalid foundation lesson: ${lesson.id}`);
    const anchor = lesson.anchorId && byId.get(lesson.anchorId);
    if (lesson.anchorId && (!anchor || !compact(anchor.detail).includes(compact(lesson.quote)))) throw Error(`Invalid source quote: ${lesson.id}`);
    const gradeMappings = anchor ? (anchor.gradeMappings || []).map(mapping => ({ ...mapping, mappingType: 'aligned_practice',
      evidence: `${mapping.sourceKind === 'public_sample' ? '原作年级与位置依据第三方样本，官方原页待核实' : '原作的年级、学期与位置已核实'}；此为依据原句自编的知识讲解与练习，不是教材原题，也不推定背诵要求。` })) :
      (lesson.textbookEvidence || []).map(evidence => {
        const book = books.get(evidence.bookId), unit = book?.units.find(unit => unit.id === evidence.unitId);
        if (!book || !unit || book.subject !== 'english' || book.editionStatus === 'historical_reference') throw Error(`Invalid grammar placement: ${lesson.id}`);
        return { grade: book.grade, bookId: book.id, schoolSystem: '5-4', semester: book.semester, edition: book.edition,
          sourceUrl: book.sourceUrl, sourceKind: 'official_textbook', sourcePdfPage: evidence.cataloguePdfPage,
          outlineDestination: `#page=${evidence.cataloguePdfPage}`, unit: `Unit ${unit.number} · ${unit.title} · 语法目录`, unitId: unit.id,
          mappingType: 'aligned_practice', status: 'catalogue_verified',
          evidence: '五四制原书目录所列语法主题已核对；电子页指目录证据页，不是语法正文页。讲解、例句与题目自编；学校印次待确认。' };
      });
    const englishLesson = ['vocabulary', 'grammar'].includes(lesson.area);
    const item = { id: lesson.id, kind: englishLesson ? 'english-reading' : 'reading', title: lesson.title,
      detail: lessonDetail(lesson), minutes: 8, learningArea: lesson.area, manualOnly: true,
      ...(lesson.textRevision ? { textRevision: lesson.textRevision } : {}),
      ...(lesson.contentRevision ? { contentRevision: lesson.contentRevision } : {}),
      source: `${areaLabels[lesson.area]} · 原创讲解与练习${englishLesson ? (lesson.curriculumPdfPage ? `；国家2022英语课标电子第${lesson.curriculumPdfPage}页` : '；关联教材来源见下方') : '；关联原作来源见下方'}`,
      note: `知识点练习，由家长安排日期；不计入自动生成的阅读篇数。${lesson.level === 'understanding' ? '课标要求层次为辨认或理解，不扩写为必须熟练运用。' : ''}`,
      referenceUrl: anchor ? anchor.referenceUrl : lesson.curriculumPdfPage ? english.sourceUrl : gradeMappings[0]?.sourceUrl,
      ...(anchor?.textSourceUrl ? { textSourceUrl: anchor.textSourceUrl } : {}),
      collections: gradeMappings.length ? ['shanghai54'] : [], gradeMappings,
      bookIds: [...new Set(gradeMappings.map(mapping => mapping.bookId))] };
    items.push(item); byId.set(item.id, item);
  }
  return studyNotes.augment(items);
}

function frameworkWithCounts(framework, catalog) {
  const count = (kind) => catalog.filter(item => item.kind === kind && !item.learningArea).length;
  const areaCount = area => catalog.filter(item => item.learningArea === area).length;
  const counts = { poetry: count('poetry'), word: count('word'), sentence: count('sentence'), reading: count('reading'),
    englishReading: count('english-reading'), recitation: areaCount('recitation'), classical: areaCount('classical'),
    vocabulary: areaCount('vocabulary'), grammar: areaCount('grammar'), recitationRequirements: recitations.entries.length,
    unmappedWords: catalog.filter(item => item.kind === 'word' && !item.gradeMappings?.length).length, ...studyNotes.counts };
  const prefixes = {
    'zh-classics': `${counts.poetry}项古诗文；${counts.recitationRequirements}处原书记诵要求；${counts.recitation}组记诵练习。`,
    'zh-classical-reading': `${counts.classical}组独立文言练习；${counts.classicalGuides}篇原作内附字词、句意与理解。`,
    'zh-reading-writing': `${counts.reading}项语文阅读、识字与拼音练习，知识点练习另计。`,
    'en-vocabulary': `${counts.word}项词汇；${counts.wordGuides}项词卡附学习辅助，包含${counts.phrasePatterns}组短语搭配、${counts.wordFamilies}组词族；${counts.vocabulary}组独立词汇练习；${counts.unmappedWords}项词汇教材年级学期待核实。`,
    'en-grammar': `${counts.grammar}组语法基础讲解与配套练习。`,
    'en-listening-speaking': `${counts.sentence}句原创口语任务；已有录音作业提交。`,
    'en-reading-writing': `${counts.englishReading}篇原创英语短文，词汇与语法知识点另计。`
  };
  return { ...framework, contentUpdatedAt: '2026-10-19', counts,
    areas: framework.areas.map(area => ({ ...area, available: prefixes[area.id] + area.available })) };
}
module.exports = { augment, frameworkWithCounts };
