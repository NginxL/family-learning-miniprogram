const { isPriorContent } = require('./completion-baseline-helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { books } = require('../scripts/lower-primary').data;
const learning = require('../shared/learning');
const resources = require('../shared/resources.json');
const { beforeChineseCorrections } = require('./chinese-baseline-helper');

const retainedIds = ['english-3b-legacy', 'chinese-4b-sample', 'english-4b-legacy',
  'chinese-5b-sample', 'english-5b-legacy', 'chinese-9b', 'english-9b-legacy'];

test('seven retained lower volumes have dated publisher and national evidence for the same five-four slot', () => {
  const retained = books.filter(book => book.editionStatus === 'historical_reference');
  assert.deepEqual(retained.map(book => book.id), retainedIds);
  for (const book of retained) {
    const review = book.sourceEvidence.editionReview;
    assert.equal(review.checkedAt, '2026-10-18');
    assert.equal(review.replacementStatus, 'new_edition_not_verified');
    assert.equal(review.status, 'historical_reference_retained');
    assert.match(review.summary, /新版原书待核实/);
    assert.match(review.pending, /2027年春季.*学校实际用书待确认/);
    assert.deepEqual(review.checks.map(check => check.source), ['publisher_catalogue', 'national_catalogue']);
    for (const check of review.checks) {
      assert.equal(check.schoolSystem, '5-4'); assert.equal(check.grade, book.grade);
      assert.equal(check.subject, book.subject); assert.equal(check.semester, book.semester);
      assert.equal(check.stage, book.grade <= 5 ? 'primary' : 'junior');
      assert.ok(check.finding && check.selection && check.url.startsWith('https://'));
    }
    if (book.subject === 'chinese') {
      assert.match(book.title, /2019审定原书·旧版参考/);
      assert.equal(book.sourceKind, 'official_textbook'); assert.equal(book.sourceEvidence.coverAuditYear, 2019);
      assert.equal(new URL(review.checks[0].url).host, 'jc.pep.com.cn');
      assert.equal(new URL(review.checks[0].listedBookUrl).host, 'book.pep.com.cn');
    } else {
      assert.equal(book.sourceKind, 'official_audio'); assert.notEqual(book.inventory.vocabularyListComplete, true);
      assert.equal(book.sourceEvidence.wordBankPrintedPagesVerified, false);
      assert.equal(new URL(review.checks[0].url).host, 'www.seph.com.cn');
      assert.equal(new URL(review.checks[0].listedCoverUrl).host, '3wm.seph.com.cn');
      assert.match(review.checks[1].selection, /沪教版/);
    }
  }
});

test('source browser exposes the seven pending editions without labelling other books as old editions', () => {
  const marked = resources.curriculum.slots.filter(slot => slot.editionReview);
  assert.deepEqual(new Set(marked.map(slot => slot.contentBookId)), new Set(retainedIds));
  for (const slot of marked) {
    assert.equal(slot.semester, '下册'); assert.equal(slot.fullCoverage, false);
    assert.equal(slot.editionReview.checkedAt, '2026-10-18');
    assert.match(slot.editionReview.summary, /新版原书待核实/);
    assert.ok(slot.editionReview.url.startsWith('https://'));
    assert.ok(learning.searchCatalog({ bookId: slot.contentBookId }).length > 0);
  }
  assert.equal(resources.curriculum.slots.filter(slot => !slot.editionReview).length, 29);
});

test('foundation additions preserve all prior identities, unchanged content and completed legacy snapshots', () => {
  const prior = learning.catalog.filter(isPriorContent).filter(item => !item.learningArea);
  const digest = rows => crypto.createHash('sha256').update(JSON.stringify(rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).digest('hex');
  assert.equal(prior.length, 4109);
  // Hashes come from the d2ed740 baseline, not from the newly generated catalogue.
  assert.equal(digest(prior.map(({ id, kind, title, minutes }) => ({ id, kind, title, minutes }))),
    'a0b204dd9f2310dbc719b1b82494bef7a37173273ff8132696266474578113a1');
  // Non-word content at b59064e stays byte-for-byte stable; vocabulary correction tests cover word bodies.
  assert.equal(digest(prior.filter(item => item.kind !== 'word').map(beforeChineseCorrections).map(({ id, kind, title, detail, minutes }) => ({ id, kind, title, detail, minutes }))),
    '7ee91ecd4a39aadb98539d948ab3db4b8f633c58d415ce783e791aa90ef3102e');
  const tasks = retainedIds.map((bookId, i) => {
    const item = learning.searchCatalog({ bookId }).find(item => ['reading', 'english-reading'].includes(item.kind));
    return { ...learning.taskFrom(item, 'child', `old-${i}`, 'new'), done: true, source: '旧版本学习时的来源快照' };
  });
  const day = { date: '2026-10-17', tasks }, ledger = { records: {} };
  learning.recordTasks(ledger, tasks, day.date);
  const beforeDay = structuredClone(day), beforeLedger = structuredClone(ledger);
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules() } };
  learning.generateDay(family, day, { child: ledger }, true);
  assert.deepEqual(day.tasks, beforeDay.tasks); assert.deepEqual(ledger, beforeLedger);
  const status = learning.learningStatus(ledger).items;
  assert.deepEqual(new Set(status.map(item => item.contentId)), new Set(tasks.map(task => task.contentId)));
  assert.ok(status.every(item => item.learnedCount === 1 && item.lastLearned === day.date));
});
