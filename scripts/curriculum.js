'use strict';
const coverage = require('../data/catalogs/shanghai-54-coverage.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');

// A publisher's book listing is not evidence that its lessons are in the app.
function curriculum() {
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
    const book = slot.subject === 'chinese' ? regional.books.find(book => book.grade === slot.grade && book.semester === slot.semester) : undefined;
    const verifiedCount = book ? new Set(book.entries.filter(entry => entry.contentId && entry.gradeVerification === 'catalogue_verified' && entry.outlineDestination).map(entry => entry.contentId)).size : 0;
    return { ...slot, contentBookId: book?.id || '', verifiedCount,
      contentStatus: verifiedCount ? 'partial' : 'pending',
      contentNote: verifiedCount ? `已核实 ${verifiedCount} 项古诗文年级映射；全册阅读、识字与表达等仍有缺项。` : '尚无已核实的逐课知识清单；不计作整册覆盖。',
      mappingNote: book ? book.verification : '' };
  }) };
}
module.exports = curriculum;
