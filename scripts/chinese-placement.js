'use strict';
const evidence = require('../data/catalogs/chinese-placement-page-evidence.json');

// Build-only proof: a verified work position never upgrades an entire sample book.
function officialPlacements(books, proof = evidence) {
  const result = new Map();
  const usedBooks = new Set();
  for (const source of proof.books) {
    const book = books.find(book => book.id === source.bookId);
    const fail = detail => { throw Error(`Invalid official placement: ${source.bookId}/${detail}`); };
    if (!book || usedBooks.has(source.bookId) || book.grade !== source.grade || book.semester !== source.semester
      || book.publisher !== source.publisher || !['五四学制', '5-4'].includes(book.schoolSystem)
      || source.schoolSystem !== '5-4' || source.sourceKind !== 'official_textbook') fail('book identity');
    usedBooks.add(source.bookId);
    const url = new URL(source.sourceUrl);
    if (url.origin !== 'https://basic.smartedu.cn' || url.pathname !== '/tchMaterial/detail'
      || url.searchParams.get('contentId') !== source.platformContentId || !source.edition) fail('official source');
    const checkPage = page => {
      const image = new URL(page.imageUrl);
      if (!Number.isInteger(page.sourcePdfPage) || page.sourcePdfPage < 1 || !/^[a-f0-9]{64}$/.test(page.sha256)
        || image.origin !== 'https://r1-ndr.ykt.cbern.com.cn'
        || !image.pathname.startsWith(`/edu_product/esp/assets/${source.platformContentId}.t/zh-CN/`)
        || !image.pathname.endsWith(`/transcode/image/${page.sourcePdfPage}.jpg`)) fail('page proof');
    };
    if (!['cover', 'publication', 'contents'].every(role => source.identityPages.some(page => page.role === role))) fail('identity pages');
    source.identityPages.forEach(checkPage);
    for (const page of source.positions) {
      checkPage(page);
      const entry = book.entries.find(entry => entry.contentId === page.contentId);
      const key = `${source.bookId}:${page.contentId}`;
      if (!entry || result.has(key) || entry.observedTitle !== page.observedTitle || entry.unitId !== page.unitId
        || entry.sourcePrintPage !== page.sourcePrintPage || entry.sourcePdfPage !== page.sourcePdfPage
        || entry.outlineDestination !== `#page=${page.sourcePdfPage}` || !page.firstLine || !page.column
        || entry.gradeVerification !== 'catalogue_verified') fail(page.contentId);
      result.set(key, { edition: source.edition, sourceUrl: source.sourceUrl, sourceKind: source.sourceKind,
        evidence: '国家平台五四制原书篇名、单元及页码已逐页核对；学校实际版次待确认。正文异文与背诵要求另列依据。' });
    }
  }
  return result;
}
module.exports = { officialPlacements };
