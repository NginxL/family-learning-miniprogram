const test = require('node:test');
const assert = require('node:assert/strict');
const inventories = require('../scripts/lower-primary').data.books;
const learning = require('../shared/learning');
const { pinyinFor } = require('../miniprogram/lib/pinyin');

test('all ten primary Chinese inventories preserve new/review character counts and writing scope', () => {
  const expected = [
    [1,'上册',280,4,100], [1,'下册',410,9,200], [2,'上册',460,20,250], [2,'下册',450,15,250],
    [3,'上册',250,27,250], [3,'下册',250,25,250], [4,'上册',250,15,250], [4,'下册',250,19,280],
    [5,'上册',200,9,220], [5,'下册',200,13,200]
  ];
  for (const [grade, semester, count, review, written] of expected) {
    const book = inventories.find(b => b.grade === grade && b.semester === semester && b.subject === 'chinese');
    assert.equal(book.inventory.recognitionCount, count);
    assert.equal(book.units.flatMap(u => u.recognition).join('').length, count + review);
    const writes = book.units.flatMap(u => u.writing).join('');
    assert.equal(writes.length, written); assert.equal(new Set(writes).size, written);
    for (const u of book.units) for (const type of ['recognition', 'writing'])
      u[type].forEach((row, i) => assert.equal([...row].length, u[type + 'Reading'][i].split(' ').length));
    assert.equal(book.inventory.fullCoverage, false); assert.equal(book.schoolAdoption, 'pending');
  }
});

test('first-grade complete audio Word banks and fourth/fifth-grade printed lists carry distinct evidence', () => {
  for (const [id, count] of [['english-1a-sample', 59], ['english-1b-sample', 64]]) {
    const b = inventories.find(b => b.id === id);
    assert.equal(b.inventory.wordBankComplete, true); assert.equal(b.inventory.wordBankCount, count);
    const entries = b.units.flatMap(u => u.wordBankEntries);
    assert.equal(entries.length, count); assert.equal(new Set(entries).size, count);
    for (const u of b.units) for (const text of u.wordBankEntries)
      assert.ok(u.words.some(w => w.text === text && w.wordBankAudioTrack));
    assert.equal(b.sourceEvidence.wordBankPrintedPagesVerified, false);
  }
  for (const [id, count, first] of [['english-4a-2026', 141, 87], ['english-5a-2026', 113, 89]]) {
    const b = inventories.find(b => b.id === id);
    assert.equal(b.inventory.vocabularyListComplete, true); assert.equal(b.inventory.vocabularyCount, count);
    assert.equal(b.units.flatMap(u => u.words).filter(w => w.vocabularyPrintPage).length, count);
    assert.deepEqual(b.sourceEvidence.vocabularyPrintPages, [first, first + 1, first + 2]);
    for (const u of b.units) for (const w of u.words.filter(w => w.vocabularyPrintPage)) {
      assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + 7);
      const item = learning.searchCatalog({ bookId: b.id, unitId: u.id }).find(i => i.kind === 'word' && (i.aliases || []).includes(w.text));
      const mapping = item.gradeMappings.find(m => m.bookId === b.id && m.unitId === u.id);
      assert.equal(mapping.sourceKind, 'official_textbook');
      assert.equal(mapping.outlineDestination, `#page=${w.vocabularyPdfPage}`);
    }
  }
  assert.equal(inventories.find(b => b.id === 'english-3a-2026').inventory.wordBankComplete, false);
  for (const grade of [3,4,5]) assert.equal(inventories.find(b => b.id === `english-${grade}b-legacy`).editionStatus, 'historical_reference');
});

test('primary supplementary poems reuse canonical records and distinguish excerpt scope and page systems', () => {
  for (const [grade, semester, total] of [[2,'下册',10],[3,'下册',10],[4,'上册',12],[4,'下册',11]])
    assert.equal(learning.searchCatalog({ grade, semester, kind: 'poetry' }).length, total);
  const grass = learning.catalogById.get('moe-2022-zh-1-6-037');
  assert.match(grass.gradeMappings.find(m => m.bookId === 'chinese-2b-sample').evidence, /后四句|后4句|前四句/);
  assert.equal(learning.catalogById.get('sh54-dizigui-conduct-excerpt').dynasty, '清代');
  const song = pinyinFor(learning.catalogById.get('sh54-solar-terms-song'));
  assert.equal(song.body.flat().find(t => t.text === '处').pinyin, 'chǔ');
  const mapped = learning.catalogById.get('sh54-dalinsi-taohua').gradeMappings[0];
  assert.equal(mapped.sourcePrintPage, 94); assert.equal(mapped.sourcePdfPage, 99);
  assert.equal(mapped.sourceKind, 'official_textbook');
  assert.ok(!learning.catalog.some(i => i.kind === 'poetry' && i.title.includes('卜算子') && i.author === '毛泽东'));
});
