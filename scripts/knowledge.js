'use strict';
const chinese = require('../data/catalogs/chinese-moe-2022-texts.json');
const english = require('../data/catalogs/english-moe-2022.json');
const tables = require('../data/catalogs/english-moe-2022-tables.json');
const foundationMeanings = require('../data/catalogs/english-foundation-meanings.json').entries;
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const examFramework = require('../data/catalogs/shanghai-zhongkao-framework.json');
const dynasties = require('../data/catalogs/poetry-dynasties.json');
const curriculum = require('./curriculum');
const lowerPrimary = require('./lower-primary');
function period(entry) {
  const metadata = dynasties.entries.find((item) => item.id === entry.id);
  if (!metadata || metadata.title !== entry.title || metadata.author !== entry.author || !metadata.dynasty || !metadata.sources.length)
    throw new Error(`Missing or mismatched dynasty evidence: ${entry.id}`);
  return { dynasty: metadata.dynasty, ...(metadata.note ? { dynastyNote: metadata.note } : {}) };
}
function knowledge() {
  const mappings = new Map();
  // These identify unique works in a named official book's visible outline.
  // Ambiguous/truncated titles and unexpanded groups remain candidates, never grade facts.
  const gradeMappings = new Map();
  regional.books.forEach((book) => book.entries.filter((entry) => entry.contentId).forEach((entry) => {
    const list = mappings.get(entry.contentId) || [];
    list.push(book.id); mappings.set(entry.contentId, list);
    if (entry.gradeVerification === 'catalogue_verified' && entry.outlineDestination) {
      const grades = gradeMappings.get(entry.contentId) || [];
      grades.push({ grade: book.grade, bookId: book.id, schoolSystem: '5-4', semester: book.semester,
        edition: book.edition, sourceUrl: book.url, outlineDestination: entry.outlineDestination,
        ...(entry.sourcePdfPage ? { sourcePdfPage: entry.sourcePdfPage } : {}),
        ...(entry.sourcePrintPage ? { sourcePrintPage: entry.sourcePrintPage, unit: entry.unit } : {}),
        ...(entry.unitId ? { unitId: entry.unitId, mappingType: 'textbook_item' } : {}),
        sourceKind: book.sourceKind || 'official_outline',
        evidence: book.sourceKind === 'public_sample' ? '五四制公开教材样本篇名、年级与位置已核对；学校使用版次待确认' : '官方教材目录篇名与册次已核对；正文异文校对另计', status: 'catalogue_verified' });
      gradeMappings.set(entry.contentId, grades);
    }
  }));
  const poems = chinese.entries.map((entry) => ({
    id: entry.id, kind: 'poetry', title: `《${entry.title}》`, author: entry.author, ...period(entry),
    detail: `${entry.author}\n${entry.original}`, minutes: entry.original.length > 300 ? 15 : 5,
    source: `国家语文课标 2022 · ${entry.gradeBand} 年级推荐 · PDF 第 ${entry.sourcePdfPage} 页`,
    referenceUrl: chinese.curriculumSource, textSourceUrl: entry.textSources[0],
    note: [entry.reviewStatus, ...entry.notes].join('；'),
    collections: ['moe-all', ...(entry.gradeBand === '1-6' ? ['foundation'] : []), ...(mappings.has(entry.id) ? ['shanghai54'] : [])],
    bookIds: mappings.get(entry.id) || [], curriculumId: entry.curriculumId, gradeMappings: gradeMappings.get(entry.id) || []
  }));
  const additional = regional.entries.map((entry) => ({
    id: entry.id, kind: 'poetry', title: `《${entry.title}》`, author: entry.author, ...period(entry),
    ...(entry.workId ? { workId: entry.workId } : {}),
    detail: `${entry.author}\n${entry.original}`, minutes: entry.original.length > 300 ? 15 : 5,
    source: entry.examEvidence ? '上海 2026 中考评析关联篇目' : entry.sourceUrl.startsWith('https://keben.app/') ? '五四制公开教材样本核对 · 公版原作 / 节选' : '五四制教材目录关联原作 · 正文待逐字核对',
    referenceUrl: entry.examEvidence || regional.books.find((book) => (mappings.get(entry.id) || []).includes(book.id)).url,
    textSourceUrl: entry.sourceUrl, note: entry.reviewStatus,
    collections: [entry.examEvidence ? 'shanghai-exam' : 'shanghai54'], bookIds: mappings.get(entry.id) || [], gradeMappings: gradeMappings.get(entry.id) || []
  }));
  const words = english.entries.map((entry) => ({
    id: entry.id, kind: 'word', title: entry.label, detail: `${entry.label}\n${foundationMeanings[entry.word] || entry.meaning}`,
    source: `国家英语课标 2022 · ${entry.level2 ? '二级带星词' : '三级词'} · 印刷页 ${entry.sourcePrintPage}；${foundationMeanings[entry.word] ? '常用义提示自编' : entry.meaningSource}`,
    minutes: 1, referenceUrl: english.sourceUrl, textSourceUrl: english.dictionary.repo,
    note: foundationMeanings[entry.word] ? '常用义提示，不是完整词典释义；校内教材单元用法待核对。' : '通用词典参考，可能含专业义或少用义；尚未按校内教材校对。',
    collections: ['moe-all', ...(entry.level2 ? ['foundation'] : [])], aliases: [entry.word]
  }));
  const tableWords = tables.entries.map((entry) => ({
    id: entry.id, kind: 'word', title: entry.word, detail: `${entry.word} · ${entry.meaning}`,
    source: `国家英语课标 2022 · ${entry.table}另列表 · PDF 第 ${entry.sourcePdfPage} 页；释义自编`,
    minutes: 1, referenceUrl: tables.sourceUrl, collections: ['tables'],
    note: '另列表，不计入课标 1600 个主词条或 505 个带星词。'
  }));
  return lowerPrimary.augment([...poems, ...additional, ...words, ...tableWords]);
}
module.exports = { knowledge, resources: {
  checkedAt: '2026-10-16',
  curriculum: curriculum(knowledge()),
  examFramework,
  coverage: '上海五四制：小学1–5、初中6–9年级。一、二年级语文四册各8单元已有原创阅读，前三册字表已核实；英语四册各10单元已有主题词汇、原创例句与阅读。语文二下完整字表、英语完整 Word bank 和高年级逐课内容仍有缺项。学校印次待确认，现有内容不代表教材或中考全量。',
  books: [...new Map([...regional.books, ...lowerPrimary.bookSummaries()].map(book => [book.id, book])).values()],
  links: [
    { title: '上海 2026 秋季教学用书通知', url: regional.noticeUrl, note: '市级用书目录；学校实际选用版本待确认' },
    { title: '上海智慧教育平台 · 教材配套资源', url: 'https://www.sh.smartedu.cn/teachingMaterial?type=11', note: '2026 学年第一学期学生版；与具体学校选用版次分开核验' },
    { title: '国家中小学智慧教育平台 · 教材', url: 'https://basic.smartedu.cn/tchMaterial', note: '完整教材在官方平台登录阅读' }
  ]
} };
