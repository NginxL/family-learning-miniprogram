const test = require('node:test');
const assert = require('node:assert/strict');
const learning = require('../shared/learning');
const chinese = require('../data/catalogs/chinese-moe-2022-texts.json');
const index = require('../data/catalogs/chinese-moe-2022-index.json');
const english = require('../data/catalogs/english-moe-2022.json');
const tables = require('../data/catalogs/english-moe-2022-tables.json');
const meanings = require('../data/catalogs/english-foundation-meanings.json');
const regional = require('../data/catalogs/shanghai-54-evidence.json');
const gradeThree = require('../data/catalogs/shanghai-54-grade3.json');
const gradeFour = require('../data/catalogs/shanghai-54-grade4.json');
const gradeFive = require('../data/catalogs/shanghai-54-grade5.json');
const inventories = require('../scripts/lower-primary').data.books;
const framework = require('../data/catalogs/shanghai-zhongkao-framework.json');
const dynasties = require('../data/catalogs/poetry-dynasties.json');

test('every poetry period has item-level evidence; doubtful authors and compilation periods stay explicit', () => {
  const poems = learning.catalog.filter(item => item.kind === 'poetry');
  assert.equal(dynasties.entries.length, poems.length);
  assert.equal(new Set(dynasties.entries.map(item => item.id)).size, poems.length);
  for (const item of poems) {
    const evidence = dynasties.entries.find(entry => entry.id === item.id);
    assert.ok(evidence && evidence.sources.length && evidence.sources.every(url => url.startsWith('https://')));
    assert.equal(item.dynasty, evidence.dynasty); assert.equal(item.author, evidence.author);
  }
  assert.equal(learning.catalogById.get('poem-goose').dynasty, '唐代');
  assert.equal(learning.catalogById.get('moe-2022-zh-7-9-048').dynasty, '三国·蜀汉');
  assert.equal(learning.catalogById.get('sh54-advice-son').dynasty, '三国·蜀汉');
  assert.equal(learning.catalogById.get('sh54-painting').dynasty, '朝代待考');
  assert.equal(learning.catalogById.get('sh54-sima-guang').dynasty, '元代');
  assert.match(learning.catalogById.get('sh54-sima-guang').dynastyNote, /编纂时代/);
  assert.match(learning.catalogById.get('sh54-archery').dynastyNote, /争议/);
  const { decorate } = require('../miniprogram/lib/page');
  const oldTask = learning.taskFrom(learning.catalogById.get('poem-goose'), 'child', 'task', 'new');
  assert.equal(oldTask.dynasty, undefined, 'metadata does not rewrite legacy wire or stored task shape');
  assert.equal(decorate(oldTask).poetryByline, '唐代 · 骆宾王');
  assert.equal(decorate({ id: 'custom', title: '咏鹅', kind: 'poetry', detail: '同名自编内容' }).poetryByline, undefined);
  assert.ok(learning.searchCatalog({ kind: 'poetry', query: '唐代' }).every(item => item.dynasty === '唐代'));
});

test('national source inventories retain 75/60 works, 1600 headword groups, 505 stars and 77 separately listed items', () => {
  assert.equal(chinese.entries.length, 135);
  assert.equal(chinese.entries.filter((entry) => entry.gradeBand === '1-6').length, 75);
  assert.equal(chinese.entries.filter((entry) => entry.gradeBand === '7-9').length, 60);
  assert.deepEqual(new Set(chinese.entries.map((entry) => entry.curriculumId)), new Set(index.entries.map((entry) => entry.id)));
  assert.ok(chinese.entries.every((entry) => entry.original && entry.textSources.length && entry.sourcePdfPage >= 65 && entry.sourcePdfPage <= 70));
  assert.equal(english.entries.length, 1600);
  assert.equal(new Set(english.entries.map((entry) => entry.word)).size, 1600);
  assert.equal(english.entries.filter((entry) => entry.level2).length, 505);
  assert.deepEqual(new Set(Object.keys(meanings.entries)), new Set(english.entries.filter((entry) => entry.level2).map((entry) => entry.word)));
  assert.equal(tables.entries.length, 77);
  assert.deepEqual(tables.entries.reduce((counts, entry) => ({ ...counts, [entry.table]: (counts[entry.table] || 0) + 1 }), {}), { '基数词': 30, '序数词': 28, '月份': 12, '星期': 7 });
  assert.equal(learning.catalog.filter((item) => item.kind === 'poetry').length, 260);
  assert.equal(learning.catalog.filter((item) => item.kind === 'word').length, 2747);
});

test('content identity preserves case and distinct same-title works; default scopes are deliberately limited', () => {
  const id = (title, kind = 'word') => {
    const exact = learning.catalog.find((entry) => entry.kind === kind && [entry.title.replace(/[《》]/g, ''), ...(entry.aliases || [])].includes(title));
    return learning.contentId({ id: 'custom-id', title, kind, detail: exact && exact.detail });
  };
  assert.equal(id('may'), 'word-may'); assert.equal(id('May'), 'word-month-may');
  assert.equal(id('miss'), 'word-miss'); assert.equal(id('Miss'), 'word-title-miss');
  assert.notEqual(id('绝句（两个黄鹂鸣翠柳）', 'poetry'), id('绝句（迟日江山丽）', 'poetry'));
  assert.equal(id('绝句', 'poetry'), 'custom-id');
  assert.equal(learning.searchCatalog({ kind: 'word', scope: 'foundation' }).length, 505);
  assert.equal(learning.searchCatalog({ kind: 'poetry', scope: 'moe-all' }).length, 135);
  assert.equal(learning.searchCatalog({ kind: 'word', scope: 'starter' }).length, 60);
  assert.ok(learning.catalogById.get('word-can').detail.includes('能；会；可以'));
  assert.ok(!learning.catalogById.get('word-may').detail.startsWith('may\nn. 五月'));
});

test('grade mappings require a named five-four textbook and an observed title; national bands never become individual grades', () => {
  const mappings = learning.catalog.filter(item => item.kind === 'poetry').flatMap((item) => (item.gradeMappings || []).map((mapping) => ({ item, mapping })));
  assert.equal(mappings.length, 267);
  for (const { item, mapping } of mappings) {
    const book = regional.books.find(entry => entry.id === mapping.bookId);
    const detailed = inventories.find(entry => entry.id === mapping.bookId);
    const poem = detailed?.units.flatMap(unit => unit.poems || []).find(poem => poem.contentId === item.id
      && poem.sourcePdfPage === mapping.sourcePdfPage && poem.sourcePrintPage === mapping.sourcePrintPage);
    assert.ok(mapping.outlineDestination);
    if (poem) assert.equal(mapping.sourceUrl, poem.sourceUrl || detailed.sourceUrl);
    else {
      assert.equal(book?.url, mapping.sourceUrl);
      assert.ok(book.entries.some(entry => entry.contentId === item.id && entry.outlineDestination === mapping.outlineDestination));
    }
    assert.equal(mapping.schoolSystem, '5-4'); assert.equal(mapping.status, 'catalogue_verified');
  }
  assert.equal(learning.searchCatalog({ kind: 'poetry', grade: 2, semester: '下册' }).length, 9, 'new original-page evidence fills the six missing 2B locations');
  assert.ok(learning.catalogById.get('moe-2022-zh-1-6-025').gradeMappings.some(m => m.grade === 2 && /两个黄鹂/.test(m.evidence)));
  assert.equal(learning.searchCatalog({ kind: 'poetry', grade: 2 }).length, 16);
  assert.equal(learning.searchCatalog({ kind: 'poetry', grade: 1 }).length, 13);
  assert.equal(learning.searchCatalog({ grade: 3 }).length, 377);
  assert.equal(learning.searchCatalog({ grade: 6 }).length, 664);
  assert.equal(learning.searchCatalog({ grade: 7 }).length, 676);
  assert.equal(learning.catalogById.get('sh54-cicada').gradeMappings.length, 1, 'sixth-grade original page now verifies the formerly pending candidate');
  for (const entry of index.entries) assert.deepEqual(entry.shanghai_textbook_mapping || [], learning.catalog.find((item) => item.curriculumId === entry.id).gradeMappings);
});

test('Shanghai exam evidence has explicit years and gaps; historical references do not become a current syllabus', () => {
  assert.equal(framework.schoolSystem, '5-4'); assert.equal(framework.referenceExamYear, 2026);
  assert.equal(framework.childExamYear, null); assert.equal(framework.complete, false); assert.equal(framework.coverageRate, null);
  assert.ok(framework.areas.every((area) => area.gap && area.status !== 'complete' && area.sourceIds.every((id) => framework.sources.some((source) => source.id === id))));
  assert.ok(framework.historicalReferences.every((source) => source.examYear === 2020 && source.currentApplicability === 'unverified'));
  const comparison = framework.historicalReferences.find((source) => source.id === 'sh-english-2020').comparison;
  assert.equal(comparison.sampleOnly, true);
  for (const word of comparison.wordsAbsentFromMoe2022MainHeadwords) assert.ok(!english.entries.some((entry) => entry.word === word));
  assert.ok(!learning.catalog.some((item) => (item.collections || []).includes('shanghai-exam-2020')));
});

test('a textbook excerpt has its own exact scope and cannot be generated as new after the full work', () => {
  const excerpt = learning.catalogById.get('sh54-moon-excerpt');
  assert.equal(excerpt.detail.split('\n').slice(1).join('').replace(/[\s，。]/g, '').length, 20);
  assert.ok(!excerpt.detail.includes('仙人垂两足'));
  const full = learning.catalogById.get(excerpt.workId); assert.ok(full.detail.includes('仙人垂两足'));
  const family = { children: [{ id: 'child' }], plans: [], autoPlans: { child: learning.emptyRules().map((rule) => rule.kind === 'poetry' ? { ...rule, quantity: 5, scope: 'all' } : rule) } };
  const ledger = { records: {} };
  learning.recordTasks(ledger, [learning.taskFrom(full, 'child', 'old', 'new')], '2026-10-11');
  // Exhaust all other works so a repeated excerpt cannot hide behind catalogue ordering.
  for (const item of learning.catalog.filter((item) => item.kind === 'poetry' && item.id !== excerpt.id))
    learning.recordTasks(ledger, [learning.taskFrom(item, 'child', item.id, 'new')], '2026-10-11');
  const day = learning.generateDay(family, { date: '2026-10-12', tasks: [] }, { child: ledger });
  assert.equal(day.tasks.length, 0); assert.equal(day.warnings.length, 1);
});

test('all built-in content fits in a compact ledger and history resolves the original app content', () => {
  const ledger = { records: {} };
  const tasks = learning.catalog.map((item, index) => ({ ...learning.taskFrom(item, 'child', `task${index}`, 'new'), done: true }));
  learning.recordTasks(ledger, tasks, '2026-10-12');
  // Every built-in item completed once leaves at least 224 KiB below the shared
  // 1 MiB application guard for custom entries and additional completion dates.
  const { requireLedgerCapacity, LEDGER_MAX_BYTES } = require('../cloudfunctions/familyApi/validation');
  assert.ok(Buffer.byteLength(JSON.stringify(ledger)) < LEDGER_MAX_BYTES - 224 * 1024);
  assert.doesNotThrow(() => requireLedgerCapacity(ledger));
  assert.ok(Object.values(ledger.records).every((entry) => entry.item.builtin));
  const result = learning.history(ledger, { query: '出师表' });
  assert.ok(result.items.some((item) => item.detail.includes('先帝创业未半')));
  const progress = learning.progress(ledger);
  assert.ok(progress.grades.every((grade) => !grade.fullGradeComplete));
  assert.equal(progress.foundations[0].learned, 75);
  assert.equal(progress.foundations[1].learned, 505);
});
