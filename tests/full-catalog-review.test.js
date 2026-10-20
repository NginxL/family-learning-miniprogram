const { isPriorContent } = require('./completion-baseline-helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { books } = require('../scripts/lower-primary').data;
const knowledge = require('../shared/knowledge-data.json');
const learning = require('../shared/learning');
const { fixture } = require('./helpers');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bookById = new Map(books.map(b => [b.id, b]));

test('all 36 five-four slots and content locations agree without duplicate mappings or practices', () => {
  const slots = new Set(books.map(b => `${b.subject}:${b.grade}:${b.semester}`));
  assert.equal(books.length, 36); assert.equal(slots.size, 36);
  for (let g = 1; g <= 9; g++) for (const s of ['chinese','english']) for (const term of ['上册','下册'])
    assert.ok(slots.has(`${s}:${g}:${term}`));
  const bodies = new Set();
  for (const b of books) {
    assert.equal(b.schoolSystem, '5-4'); assert.equal(b.schoolAdoption, 'pending');
    assert.equal(b.inventory.fullCoverage, false);
    for (const u of b.units) {
      const text = u.practice.body.replace(/[\s\p{P}]/gu, '').toLowerCase();
      assert.ok(!bodies.has(text), `${b.id}/${u.id}: repeated original reading`); bodies.add(text);
      if (u.words) assert.equal(new Set(u.words.map(w => w.text)).size, u.words.length);
    }
  }
  for (const item of knowledge) {
    const ms = item.gradeMappings || [];
    assert.equal(new Set(ms.map(m => JSON.stringify(m))).size, ms.length, item.id);
    for (const m of ms) {
      const b = bookById.get(m.bookId); assert.ok(b, item.id);
      assert.equal(m.grade, b.grade); assert.equal(m.semester, b.semester); assert.equal(m.schoolSystem, '5-4');
      if (m.unitId) assert.ok(b.units.some(u => u.id === m.unitId));
      assert.ok(m.sourceUrl.startsWith('https://'));
      if (m.sourceKind === 'official_audio') {
        assert.equal(m.sourcePrintPage, undefined); assert.equal(m.sourcePdfPage, undefined);
      }
    }
  }
});

test('all 4064 pre-review knowledge IDs and 4072 grade/unit associations survive the source upgrade', () => {
  const old = knowledge.filter(isPriorContent).filter(i => !i.learningArea && i.id !== 'sh54-word-flour');
  assert.equal(old.length, 4064);
  assert.equal(hash(old.map(i => i.id).sort().join('\n')), '749228be83e0a72567d96ec7041fedae1dd0aff575d91d99303f410df9c7f340');
  const mappings = old.flatMap(i => (i.gradeMappings || []).map(m => [i.id,m.bookId,m.unitId || '',m.grade,m.semester].join('|'))).sort();
  assert.equal(mappings.length, 4072);
  assert.equal(hash(mappings.join('\n')), 'e5bad0e25b56e82464fd5ee3dbe407609f6d77eb35bd5582b2351eba365b4d2c');
  const aliases = new Map();
  for (const item of learning.catalog.filter(i => i.kind === 'word')) for (const a of item.aliases || [item.title]) {
    assert.ok(!aliases.has(a) || aliases.get(a) === item.id, `Ambiguous word ${a}`); aliases.set(a,item.id);
  }
  // Case has meaning; these must not be merged by a case-insensitive deduplicator.
  for (const [a,b] of [['may','May'],['miss','Miss'],['it','IT']]) assert.notEqual(aliases.get(a),aliases.get(b));
});

test('the third-grade upper word list uses all three original pages and resolves the flour homophone', () => {
  const b = bookById.get('english-3a-2026');
  assert.equal(b.sourceKind, 'official_textbook'); assert.equal(b.sourceEvidence.coverAuditYear, 2024);
  assert.equal(b.inventory.vocabularyListComplete, true); assert.equal(b.inventory.vocabularyCount, 159);
  assert.deepEqual(b.units.map(u => u.words.length), [14,17,19,18,17,12,14,18,15,15]);
  assert.deepEqual(b.sourceEvidence.vocabularyPrintPages, [87,88,89]);
  assert.equal(hash(b.units.flatMap(u => u.words.map(w => `${u.id}:${w.text}:${w.vocabularyPrintPage}`)).join('\n')),
    '2092b50ead5447347fd1495b7a34e77157ab178403a36686f83da6d26513d5db');
  for (const u of b.units) for (const w of u.words) {
    assert.equal(w.vocabularyPdfPage, w.vocabularyPrintPage + 7);
    const item = learning.searchCatalog({ bookId:b.id,unitId:u.id,kind:'word' }).find(i => i.aliases.includes(w.text));
    assert.ok(item); assert.equal(item.gradeMappings.find(m => m.bookId === b.id && m.unitId === u.id).sourcePrintPage,w.vocabularyPrintPage);
  }
  assert.equal(b.units[6].words.find(w => w.text === 'writer').vocabularyPrintPage,88);
  assert.equal(b.units[6].words.find(w => w.text === 'doctor').vocabularyPrintPage,89);
  assert.equal(b.units[9].words.find(w => w.text === 'flour').meaning,'面粉');
  assert.ok(!b.units[9].words.some(w => w.text === 'flower'));
  assert.equal(b.units[7].words.find(w => w.text === 'ask for help').textbookForm,'ask … for help');
});

test('the seven lower-volume legacy editions remain explicit and fifth-grade Chinese now has official evidence', () => {
  const legacy = books.filter(b => b.editionStatus === 'historical_reference');
  assert.equal(legacy.length,7);
  for (const b of legacy) {
    const review = b.sourceEvidence.editionReview;
    assert.equal(review.status,'historical_reference_retained'); assert.match(review.pending,/2027年春季/);
    if (b.subject === 'english') {
      assert.equal(review.resourcePeriod,'2025学年第二学期'); assert.equal(review.calendarPeriod,'2026年春季');
      assert.equal(review.localCataloguePdfPage,b.grade <= 5 ? 1 : 6);
      assert.ok(!b.inventory.vocabularyListComplete); assert.equal(b.sourceEvidence.wordBankPrintedPagesVerified,false);
    }
  }
  const b = bookById.get('chinese-5b-sample');
  assert.equal(b.sourceKind,'official_textbook');
  assert.equal(new URL(b.sourceUrl).searchParams.get('contentId'),'f182b376-35af-4e94-849a-91ea3f97023c');
  assert.equal(b.sourceEvidence.coverAuditYear,2019);
  assert.deepEqual(b.sourceEvidence.officialReview.recognitionPdfPages,[138,139]);
  assert.deepEqual(b.sourceEvidence.officialReview.writingPdfPages,[140,141]);
  for (const item of learning.searchCatalog({ bookId:b.id })) {
    const m = item.gradeMappings.find(m => m.bookId === b.id);
    assert.equal(m.sourceUrl,b.sourceUrl); assert.equal(m.sourceKind,'official_textbook');
    assert.equal(m.sourcePdfPage,m.sourcePrintPage + 5);
  }
});

test('starter cards retain reviewed textbook senses and do not erase later-unit meanings', () => {
  for (const [id, meaning] of [['word-water','浇水'],['word-star','星形'],['word-helpful','乐于助人的'],['word-evening','傍晚']])
    assert.ok(learning.catalogById.get(id).detail.includes(meaning),id);
  for (const b of books) for (const u of b.units) for (const w of u.words || []) if (w.additionalSense) {
    const item = learning.searchCatalog({ bookId:b.id,unitId:u.id,kind:'word' }).find(i => i.aliases.includes(w.text));
    const meanings = w.textbookSenses?.length ? w.textbookSenses.map(sense => sense.meaning) : [w.meaning];
    for (const sense of meanings.flatMap(meaning => require('../scripts/english-vocabulary').splitMeanings(meaning)))
      assert.ok(item.detail.replace(/\s/g, '').includes(sense.replace(/\s/g, '')),`${b.id}/${u.id}/${w.text}: ${sense}`);
  }
});

test('full poem credit covers its exact excerpt in one direction without altering old tasks or inventing mastery', () => {
  const full = learning.catalogById.get('moe-2022-zh-1-6-018'), excerpt = learning.catalogById.get('sh54-moon-excerpt');
  const ledger = { records:{} }, old = { ...learning.taskFrom(full,'child','old','new'),done:true };
  old.detail = old.detail.replace(/，/g,'， '); const snapshot = structuredClone(old);
  learning.recordTasks(ledger,[old],'2026-10-12'); const before = structuredClone(ledger);
  const status = learning.learningStatus(ledger).items.find(i => i.contentId === excerpt.id);
  assert.ok(status); assert.equal(status.mastered,false);
  assert.equal(learning.history(ledger).total,1); assert.deepEqual(ledger,before);
  const short = { records:{} }; learning.recordTasks(short,[{ ...learning.taskFrom(excerpt,'child','short','new'),done:true }],'2026-10-12');
  assert.ok(!learning.learningStatus(short).items.some(i => i.contentId === full.id));
  const family = { children:[{id:'child'}],plans:[],autoPlans:{child:learning.emptyRules()} };
  const day = { date:'2026-10-12',tasks:[old] }; learning.generateDay(family,day,{child:ledger},true);
  assert.deepEqual(day.tasks[0],snapshot);
});

test('reviewed sources and new vocabulary sync with old word records after a lost response', async () => {
  const f = fixture(), family = await f.family(); await f.addParent(family.id);
  const childId = family.children[0].id, base = { familyId:family.id,childId }, date='2026-10-13';
  await f.call('parent-a','saveAutoPlans',{...base,rules:learning.emptyRules()});
  const ids = ['word-water','sh54-word-flour','sh54-zh-5b-u1-literacy'];
  for (const contentId of ids) await f.call('parent-a','assignContent',{...base,contentId,date});
  f.advance(86400000);
  const a = f.client('parent-a'), b = f.client('parent-b'); await a.engine.sync(date); await b.engine.sync(date);
  for (const t of a.engine.viewDay(date).tasks) a.engine.enqueue(date,t.id,true);
  a.loseNextResponse(); await a.engine.sync(date); await a.engine.sync(date); await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(t => t.done));
  const status = await b.engine.getLearningStatus({childId}); assert.deepEqual(new Set(status.items.map(i => i.contentId)),new Set(ids));
  assert.ok(status.items.every(i => i.learnedCount === 1 && !i.mastered));
});
