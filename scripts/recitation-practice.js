'use strict';
const { createHash } = require('node:crypto');
const recitations = require('../data/catalogs/chinese-recitation-requirements.json');
const excerptEvidence = require('../data/catalogs/chinese-excerpt-evidence.json').entries[0];
const grades = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'];
const excerptId = 'sh54-grass-excerpt';
function augment(items) {
  const full = items.find(item => item.id === 'moe-2022-zh-1-6-037');
  const mapping = { ...full.gradeMappings.find(mapping => mapping.bookId === 'chinese-2b-sample'),
    sourceKind: 'official_textbook', sourceUrl: excerptEvidence.sourceUrl,
    sourcePrintPage: excerptEvidence.sourcePrintPage, sourcePdfPage: excerptEvidence.sourcePdfPage,
    outlineDestination: `#page=${excerptEvidence.sourcePdfPage}` };
  const excerpt = { ...full, id: excerptId, title: '《赋得古原草送别》（前四句）',
    detail: '白居易\n离离原上草，一岁一枯荣。\n野火烧不尽，春风吹又生。',
    workId: full.id, minutes: 3, minimumServiceVersion: 1,
    collections: ['shanghai54'], bookIds: [mapping.bookId], gradeMappings: [{ ...mapping,
      evidence: '官方原书电子第17页、印刷第12页：语文园地一“日积月累”，标题注明“节选”，正文仅前四句。此页未写“背诵/默写”指令，不推定为课后必背要求；学校印次待确认。' }],
    source: '五四制二年级下册 · 语文园地一 · 日积月累 · 前四句',
    referenceUrl: mapping.sourceUrl, textSourceUrl: mapping.sourceUrl,
    note: '教材节选独立记录。完成此卡只记录前四句，不记作全诗已学；全文卡保留原有记录。',
    studyNotes: { title: '节选练习', notice: '依据教材节选自编；该页没有明确背诵或默写指令。', sections: [{ title: '学习范围', body: '本卡只学习教材选录的前四句。后四句请到全文卡单独学习。' }],
      exercises: [{ question: '先朗读前四句，再遮住正文试着背诵；能够背诵后，可以自选默写。', answer: '离离原上草，一岁一枯荣。\n野火烧不尽，春风吹又生。' }],
      sources: [{ title: '二下原书电子第17页', url: mapping.sourceUrl }], searchTerms: ['前四句', '节选'] } };
  delete excerpt.curriculumId; delete excerpt.coveredContentIds;
  full.coveredContentIds = [...(full.coveredContentIds || []), excerptId];
  items.push(excerpt);
  const byId = new Map(items.map(item => [item.id, item]));
  for (const entry of recitations.entries.filter(entry => entry.requirement.startsWith('背诵'))) {
    const item = byId.get(entry.contentId);
    const location = item.gradeMappings.find(mapping => mapping.bookId === entry.bookId);
    const body = item.author && item.detail.startsWith(`${item.author}\n`) ? item.detail.slice(item.author.length + 1) : item.detail;
    const from = entry.start ? body.indexOf(entry.start) : 0;
    const end = entry.end ? body.indexOf(entry.end, from) + entry.end.length : body.length;
    if (from < 0 || end <= from || (entry.end && !body.slice(from).includes(entry.end))) throw Error(`Invalid practice range: ${entry.contentId}`);
    const answer = body.slice(from, end);
    const label = `${grades[location.grade]}${location.semester}${location.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}：${entry.requirement}`;
    const writing = entry.requirement.includes('默写');
    item.studyNotes ||= { title: '背诵与自测', notice: '按具名教材要求的范围自编练习。自测不自动标记完成或掌握。', sections: [{ title: '怎样自测', body: '先读准，再遮住正文背诵；需要默写时，写完后逐字核对。自测后仍由家长确认完成。' }], exercises: [], sources: [], searchTerms: [] };
    item.recitationPractice ||= [];
    const exercise = { question: `${label}。${entry.start ? `范围从“${entry.start}”到“${entry.end}”。` : ''}遮住正文${writing ? '背诵并默写' : '背诵；另可自选默写自测（教材此条未要求默写）'}，再逐字核对。`, answer };
    item.recitationPractice.push({ bookId: entry.bookId, requirement: entry.requirement, start: entry.start, end: entry.end,
      answerSha256: createHash('sha256').update(answer).digest('hex') });
    item.studyNotes.exercises.push(exercise);
    item.studyNotes.sources.push({ title: `${label} · 原书第${entry.sourcePrintPage}页`, url: entry.sourceUrl });
    if (!item.studyNotes.searchTerms.includes('背诵自测')) item.studyNotes.searchTerms.push('背诵自测');
  }
  return items;
}
module.exports = { augment, excerptId };
