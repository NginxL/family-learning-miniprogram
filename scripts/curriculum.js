'use strict';
const coverage = require('../data/catalogs/shanghai-54-coverage.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const lowerPrimary = require('./lower-primary');

function inventoryNote(book) {
  if (book.subject === 'chinese') return book.inventory.recognitionComplete && book.inventory.writingComplete
    ? `${book.editionStatus === 'historical_reference' ? '历史审定样本，新版下册待核实；' : ''}识字表 ${book.inventory.recognitionCount} 字、写字表 ${book.inventory.writingCount} 字已整理（含另列多音字复习）；`
    : '完整识字表、写字表待原页核实；';
  if (book.inventory.vocabularyListName) return `${book.editionStatus === 'historical_reference' ? '旧版参考，当前新版下册待核实；' : ''}官方配套音频 ${book.inventory.vocabularyListName} 已整理 ${book.inventory.vocabularyCount} 个单元词项（含跨单元复现）；纸本词表完整性待核验；`;
  if (!book.inventory.wordBankComplete) return '目录主题词汇已整理，完整 Word bank 待核验；';
  return book.inventory.wordBankBasis === 'public_sample_pages'
    ? `公开样本 Word bank ${book.inventory.wordBankCount} 项已整理；与官方音频的差异已标注，学校纸本待确认；`
    : `官方配套音频 Word bank ${book.inventory.wordBankCount} 项已整理；与目录不同的短语另行保留，纸本原页待确认；`;
}

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
      contentNote: lower ? `${availableUnits} 个单元已有配套学习内容：${verifiedCount - practiceCount} 项教材字词／古诗与 ${practiceCount} 项原创练习。${inventoryNote(lower)}不代表教材全部知识。`
        : verifiedCount ? `已核实 ${verifiedCount} 项古诗文年级映射；全册阅读、识字与表达等仍有缺项。` : '尚无已核实的逐课知识清单；不计作整册覆盖。',
      mappingNote: book ? book.verification : '' };
  }) };
}
module.exports = curriculum;
