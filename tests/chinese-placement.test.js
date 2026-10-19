const test = require('node:test');
const assert = require('node:assert/strict');
const proof = require('../data/catalogs/chinese-placement-page-evidence.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const { officialPlacements } = require('../scripts/chinese-placement');
const learning = require('../shared/learning');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const { hash } = require('./post-review-baseline-helper');
const baseline = require('./fixtures/placement-baseline.json');

test('31 work placements resolve to their own official pages without borrowing recitation page numbers', () => {
  assert.deepEqual(proof.books.map(book => book.positions.length), [6, 7, 7, 11]);
  assert.equal(new Set(proof.books.flatMap(book => book.positions.map(page => page.imageUrl))).size, 29);
  assert.equal(officialPlacements(regional.books).size, 31);
  for (const book of proof.books) for (const page of book.positions) {
    const item = learning.catalogById.get(page.contentId), view = withContentSources(item);
    const mapping = view.sourceMappings.find(m => m.bookId === book.bookId);
    assert.equal(mapping.sourceKind, 'official_textbook'); assert.equal(mapping.sourceUrl, book.sourceUrl);
    assert.equal(mapping.grade, book.grade); assert.equal(mapping.semester, book.semester);
    assert.equal(mapping.sourcePrintPage, page.sourcePrintPage); assert.equal(mapping.sourcePdfPage, page.sourcePdfPage);
    assert.equal(mapping.unitId, page.unitId); assert.equal(mapping.verificationLabel, '官方教材来源');
    assert.match(mapping.evidence, /学校实际版次待确认/);
  }
  const river = learning.catalogById.get('moe-2022-zh-1-6-001');
  assert.equal(river.gradeMappings.find(m => m.bookId === 'chinese-1a-sample').sourcePrintPage, 62);
  assert.equal(river.recitationRequirements.find(r => r.bookId === 'chinese-1a-sample').sourcePrintPage, 63);
  const moon = learning.catalogById.get('sh54-moon-excerpt');
  assert.match(moon.detail, /飞在青云端/); assert.doesNotMatch(moon.detail, /仙人垂两足/);
});

test('official placement proof rejects wrong books, pages, titles and unsupported image provenance', () => {
  for (const mutate of [
    p => { p.books[0].grade = 2; }, p => { p.books[0].semester = '下册'; },
    p => { p.books[0].sourceUrl = 'https://keben.app/book/0358'; },
    p => { p.books[0].positions[0].sourcePrintPage++; },
    p => { p.books[0].positions[0].sourcePdfPage++; },
    p => { p.books[0].positions[0].observedTitle = '登高'; },
    p => { p.books[0].positions[0].unitId = 'u2'; },
    p => { p.books[0].positions[0].sha256 = ''; },
    p => { p.books[0].positions[0].imageUrl = 'https://example.com/21.jpg'; },
    p => { p.books[0].identityPages = []; },
    p => { p.books[0].positions.push(p.books[0].positions[0]); }
  ]) {
    const changed = structuredClone(proof); mutate(changed);
    assert.throws(() => officialPlacements(regional.books, changed), /Invalid official placement/);
  }
});

test('work-only evidence does not upgrade unreviewed character tables or original unit themes', () => {
  const partial = structuredClone(proof); partial.books[0].positions.shift();
  assert.equal(officialPlacements(regional.books, partial).has('chinese-1a-sample:poem-goose'), false);
  for (const id of ['chinese-1a-sample', 'chinese-1b-sample', 'chinese-2a-sample']) {
    const unreviewed = learning.catalog.flatMap(item => item.gradeMappings || [])
      .filter(mapping => mapping.bookId === id && mapping.sourceKind === 'public_sample');
    assert.ok(unreviewed.length > 0);
    for (const mapping of unreviewed) {
      assert.equal(new URL(mapping.sourceUrl).hostname, 'keben.app');
      assert.match(mapping.evidence, /官方原页.*待核实/);
    }
  }
  const practice = learning.catalogById.get('skill-zh-sh54-sima-guang');
  assert.equal(practice.gradeMappings[0].sourceKind, 'official_textbook');
  assert.equal(practice.gradeMappings[0].mappingType, 'aligned_practice');
  assert.match(practice.gradeMappings[0].evidence, /自编.*不是教材原题/);
});

test('official source replacements preserve every task snapshot, numeric progress and learned/mastered state', () => {
  assert.equal(hash(learning.catalog.map(item => learning.taskFrom(item, 'child', 'task-' + item.id, 'manual'))), baseline.tasksSha256);
  assert.equal(hash(learning.progress({ records: {} })), baseline.progressSha256);
  const ledger = { records: {} };
  const tasks = proof.books.flatMap(book => book.positions.map(page => ({ ...learning.taskFrom(
    learning.catalogById.get(page.contentId), 'child', 'old-' + page.contentId, 'manual'), done: true })));
  learning.recordTasks(ledger, tasks, '2026-10-18');
  for (const record of Object.values(ledger.records)) record.mastered = true;
  const before = JSON.stringify({ tasks, ledger });
  for (const task of tasks) {
    const view = withContentSources(task); assert.equal(view.textCorrectionNotice, ''); assert.equal(view.detail, task.detail);
  }
  assert.equal(JSON.stringify({ tasks, ledger }), before);
  const status = learning.learningStatus(ledger);
  assert.equal(status.items.length, 31);
  assert.ok(status.items.every(item => item.learnedCount === 1 && item.mastered));
});
