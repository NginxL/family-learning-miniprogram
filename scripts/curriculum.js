'use strict';
const coverage = require('../data/catalogs/shanghai-54-coverage.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const lowerPrimary = require('./lower-primary');

// A publisher's book listing is not evidence that its lessons are in the app.
function curriculum(items) {
  const keys = new Set();
  for (const slot of coverage.slots) {
    const key = `${slot.subject}:${slot.grade}:${slot.semester}`;
    if (keys.has(key) || !coverage.subjects.includes(slot.subject) || !Number.isInteger(slot.grade) || slot.grade < 1 || slot.grade > 9
      || !['上册', '下册'].includes(slot.semester) || slot.stage !== (slot.grade <= 5 ? 'primary' : 'junior')
      || !slot.references.length || slot.references.some(ref => !coverage.sources.some(source => source.id === ref.sourceId)))
      throw Error(`Invalid Shanghai five-four coverage slot: ${slot.id}`);
    keys.add(key);
  }
  if (keys.size !== 36 || coverage.complete || coverage.slots.some(slot => slot.fullCoverage))
    throw Error('Full curriculum coverage needs separately verified lesson inventories');
  return { ...coverage, slots: coverage.slots.map(slot => {
    const lower = lowerPrimary.data.books.find(book => book.subject === slot.subject && book.grade === slot.grade && book.semester === slot.semester);
    const book = lower ? { ...lower, verification: `${lower.edition}；学校实际采用版次待确认。` }
      : slot.subject === 'chinese' ? regional.books.find(book => book.grade === slot.grade && book.semester === slot.semester) : undefined;
    const selected = book ? items.filter(item => item.gradeMappings?.some(mapping => mapping.bookId === book.id)) : [];
    const verifiedCount = selected.length;
    const practiceCount = selected.filter(item => item.gradeMappings?.some(mapping => mapping.bookId === book.id && mapping.mappingType === 'aligned_practice')).length;
    const availableUnits = lower ? lower.units.length : 0;
    return { ...slot, contentBookId: book?.id || '', verifiedCount,
      practiceCount, textbookCount: verifiedCount - practiceCount, availableUnits,
      contentStatus: verifiedCount ? 'partial' : 'pending',
      contentNote: lower ? `${availableUnits} 个单元已有配套学习内容：${verifiedCount - practiceCount} 项教材字词／古诗与 ${practiceCount} 项原创练习。${lower.subject === 'chinese' ? `识字表 ${lower.inventory.recognitionCount} 字、写字表 ${lower.inventory.writingCount} 字已整理（含另列多音字复习）；` : '目录主题词汇已整理，完整 Word bank 待核验；'}不代表教材全部知识。`
        : verifiedCount ? `已核实 ${verifiedCount} 项古诗文年级映射；全册阅读、识字与表达等仍有缺项。` : '尚无已核实的逐课知识清单；不计作整册覆盖。',
      mappingNote: book ? book.verification : '' };
  }) };
}
module.exports = curriculum;
