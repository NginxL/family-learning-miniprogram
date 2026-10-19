const { isPriorContent } = require('./completion-baseline-helper');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const learning = require('../shared/learning');
const knowledge = require('../shared/knowledge-data.json');
const { books } = require('../scripts/lower-primary').data;
const evidence = require('../data/catalogs/english-vocabulary-review.json');
const foundation = require('../data/catalogs/english-foundation-meanings.json').entries;
const repairs = require('../data/catalogs/english-common-sense-repairs.json').entries;
const guides = require('../data/catalogs/english-word-study.json');
const baseline = require('./fixtures/english-corrections-baseline.json');
const { withoutWordPresentation } = require('./english-baseline-helper');
const { beforePostReviewCorrections } = require('./post-review-baseline-helper');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const { decorate } = require('../miniprogram/lib/page');
const { fixture } = require('./helpers');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const word = name => learning.catalog.find(item => item.kind === 'word' && [item.title, ...(item.aliases || [])].includes(name));
const occurrence = (bookId, unitId, text) => books.find(b => b.id === bookId).units.find(u => u.id === unitId).words.find(w => w.text === text);

test('English corrections preserve all IDs, placements, pools and every non-word field against b59064e', () => {
  assert.equal(knowledge.filter(isPriorContent).length, baseline.knowledgeCount);
  assert.equal(learning.catalog.filter(isPriorContent).length, baseline.catalogCount);
  assert.equal(hash(knowledge.filter(isPriorContent).map(beforePostReviewCorrections).map(withoutWordPresentation)), baseline.stableSha256);
  assert.equal(hash(knowledge.filter(isPriorContent).filter(item => item.kind !== 'word').map(beforePostReviewCorrections)), baseline.nonWordSha256);
  assert.equal(books.filter(b => b.editionStatus === 'historical_reference').length, 7);
});

test('every mapped foundation sense survives later units without relying on additionalSense', () => {
  for (const [head, meaning] of Object.entries(foundation)) {
    const item = word(head); assert.ok(item, head);
    for (const sense of meaning.split('；')) assert.ok(item.detail.includes(sense), `${head}: ${sense}`);
  }
  for (const [head, body] of Object.entries(repairs)) {
    const item = word(head); assert.ok(item);
    for (const line of body.split('\n')) {
      const match = line.match(/^([a-z. ]+) (.+)$/);
      if (match) assert.ok(require('../scripts/english-vocabulary').hasSense(item.detail, match[1], match[2]), `${head}: ${line}`);
      else assert.ok(item.detail.includes(line), `${head}: ${line}`);
    }
  }
  for (const [head, sense] of [['taste','味道'],['fish','鱼肉'],['rain','下雨'],['snow','下雪'],['art','艺术'],['rice','稻米']])
    assert.ok(word(head).detail.includes(sense), head);
});

test('all 2146 printed occurrences have page-bound POS/senses, without inventing POS for expressions or audio', () => {
  assert.equal(evidence.books.length, 10); assert.equal(evidence.books.flatMap(b => b.pages).length, 45);
  let count = 0, unlabelled = 0;
  const allowed = /^(?:(?:modal )?v|n|adj|adv|prep|pron|conj|det|num|abbr)\.(?: & (?:v|n|adj|adv|prep|pron|det)\.)?$/;
  for (const proof of evidence.books) {
    const book = books.find(b => b.id === proof.bookId);
    assert.deepEqual([proof.grade, proof.semester, proof.schoolSystem, proof.edition, proof.sourceUrl],
      [book.grade, book.semester, '5-4', book.edition, book.sourceUrl]);
    assert.ok(book.sourceUrl.startsWith('https://basic.smartedu.cn/'));
    const rows = book.units.flatMap(unit => unit.words.filter(w => w.vocabularyPrintPage).map(w => ({ unit, w })));
    assert.equal(rows.length, proof.wordCount); count += rows.length;
    for (const { unit, w } of rows) {
      const page = proof.pages.find(p => p.sourcePdfPage === w.vocabularyPdfPage);
      assert.ok(page); assert.equal(page.sourcePrintPage, w.vocabularyPrintPage); assert.match(page.sha256, /^[a-f0-9]{64}$/);
      assert.ok(w.textbookSenses.length);
      const item = word(w.text), map = item.gradeMappings.find(m => m.bookId === book.id && m.unitId === unit.id);
      for (const sense of w.textbookSenses) {
        if (sense.partOfSpeech !== null) assert.match(sense.partOfSpeech, allowed);
        else unlabelled++;
        assert.ok(sense.meaning); assert.doesNotMatch(sense.meaning, /本词表|未列入词汇表|Unit \d|被认力|[\x00-\x08]/);
        assert.ok(item.detail.includes(sense.meaning)); assert.ok(map.evidence.includes(sense.meaning));
      }
    }
  }
  assert.equal(count, 2146); assert.equal(unlabelled, 223);
  for (const b of books.filter(b => b.subject === 'english' && !b.inventory.vocabularyListComplete))
    assert.ok(b.units.flatMap(u => u.words).every(w => !w.textbookSenses));
  assert.equal(occurrence('english-4a-2026','u6','quick').textbookSenses[0].partOfSpeech, null);
  assert.match(word('practice').detail, /practise \(AmE practice\).*v\. 练习/);
  assert.match(word('ask for help').detail, /ask … for help/);
});

test('the thirteen reported unit errors match the original pages and do not leak another unit sense', () => {
  const expected = [
    ['english-4a-2026','u2','duck',87,'v.','躲闪；躲避'],
    ['english-4a-2026','u6','quick',88,null,'快！'],
    ['english-7b-2024','u4','even though',132,null,'尽管；虽然'],
    ['english-8a-2024','u3','rate',136,'v.','划分等级；评估'],
    ['english-8a-2024','u4','belong',136,'v.','应在（某处）'],
    ['english-8a-2024','u6','tower',139,'v.','高于，超过（附近的人或物）'],
    ['english-8a-2024','u6','figure',139,'v.','计算'],
    ['english-8a-2024','u6','circle',138,'v.','（尤指在空中）盘旋，环行'],
    ['english-8b-2024','u4','grade',131,'n.','分数'],
    ['english-8b-2024','u5','go off',131,null,'断电'],
    ['english-8b-2024','u5','pick up',131,null,'增强；改善；收拾'],
    ['english-9a-2024','u3','introduction',133,'n.','初次经历；首次体验'],
    ['english-9a-2024','u6','pick up',135,null,'学会']
  ];
  assert.equal(evidence.corrections.length, expected.length);
  for (const [book,unit,head,page,pos,meaning] of expected) {
    const w = occurrence(book,unit,head);
    assert.equal(w.vocabularyPrintPage,page); assert.deepEqual(w.textbookSenses[0],{partOfSpeech:pos,meaning});
  }
  assert.doesNotMatch(word('even though').detail, /即使/);
  assert.deepEqual(occurrence('english-8a-2024','u6','circle').textbookSenses[1], {partOfSpeech:'n.',meaning:'圆形'});
  assert.deepEqual(occurrence('english-6b-2024','u1','notice').textbookSenses.map(s=>s.partOfSpeech), ['v.','n.']);
  assert.deepEqual(occurrence('english-6a-2024','u3','surprise').textbookSenses.map(s=>s.partOfSpeech), ['n.','v.']);
});

test('all 599 inflection guides bind forms to visible POS and meaning, including ambiguous exercises', () => {
  assert.equal(guides.entries.filter(e => e.forms.length).length, 599);
  for (const entry of guides.entries) {
    const item = learning.catalogById.get(entry.contentId);
    for (const form of entry.forms) {
      assert.ok(form.sense?.partOfSpeech); assert.ok(form.sense.meaning);
      // Several same-POS meanings may share one line after exact duplicate removal.
      const lines = item.detail.split('\n').map(line => line.match(/^(?:[^·\n]+ · )?([a-z. &]+) (.+)$/))
        .filter(match => match && match[1].split(/\s*&\s*/).includes(form.sense.partOfSpeech));
      assert.ok(form.sense.meaning.split('；').every(part => lines.some(match => match[2].split('；').includes(part))), `${entry.lemma}: ${form.label}`);
      assert.ok(item.studyNotes.sections[0].body.includes(form.sense.meaning));
    }
    if (entry.forms.some(f => /表达/.test(f.label))) assert.match(item.studyNotes.exercises[0].answer, /示例.*其他.*也可/);
    if (!entry.forms.length && !entry.patterns.length) assert.match(item.studyNotes.exercises[0].question, /词族/);
  }
  const get = head => guides.entries.find(e=>e.lemma===head);
  assert.equal(get('company').forms[0].sense.meaning, '公司');
  assert.match(word('company').studyNotes.exercises[0].question, /company「公司」/);
  assert.equal(get('fine').forms[0].sense.meaning, '优质的；精细的');
  assert.match(get('fine').pitfalls.join(''), /身体好/);
  for (const f of get('light').forms) assert.equal(f.sense.partOfSpeech, f.label.startsWith('动词') ? 'v.' : 'adj.');
  for (const head of ['correct','land','form','point','divide','mistake','tear']) assert.ok(get(head).forms.every(f=>f.sense.partOfSpeech==='v.'));
  assert.match(get('shine').pitfalls[0], /“擦亮、擦光”的过去式和过去分词用 shined/);
  assert.match(get('traffic').pitfalls[0], /可数的是 jam/);
});

test('old word snapshots retain completion and mastery while showing the current card separately', () => {
  for (const old of baseline.oldWords) {
    const task={...learning.taskFrom(old,'child','old-'+old.id,'manual'),done:true};
    const ledger={records:{}};learning.recordTasks(ledger,[task],'2026-10-12');ledger.records[old.id].mastered=true;
    const day={date:'2026-10-12',tasks:[task]}, family={children:[{id:'child'}],plans:[],autoPlans:{child:learning.emptyRules()}};
    const before=JSON.stringify({tasks:day.tasks,ledger});
    const view=withContentSources(decorate(task));
    assert.equal(view.detail,old.detail); assert.match(view.textCorrectionNotice,/词义和词形说明已校订/);
    assert.equal(view.correctedDetail,learning.catalogById.get(old.id).detail);
    learning.generateDay(family,day,{child:ledger},true);assert.equal(JSON.stringify({tasks:day.tasks,ledger}),before);
    assert.equal(learning.learningStatus(ledger).items[0].learnedCount,1);
    assert.equal(learning.learningStatus(ledger).items[0].mastered,true);
    const fresh=learning.taskFrom(learning.catalogById.get(old.id),'child','new','manual');
    assert.equal(withContentSources(decorate(fresh)).textCorrectionNotice,'');
    assert.ok(!JSON.stringify(fresh).includes('vocabularyRevision'));
  }
  const custom=withContentSources(decorate({id:'custom-word',kind:'word',title:'company',detail:'自建词卡'}));
  assert.equal(custom.vocabularyRevision,undefined);assert.equal(custom.correctedDetail,'');
});

test('corrected vocabulary syncs across two parents with an offline retry and a single completion record', async () => {
  const f=fixture(), family=await f.family();await f.addParent(family.id);
  const childId=family.children[0].id,date='2026-10-12';
  await f.call('parent-a','saveAutoPlans',{familyId:family.id,childId,rules:learning.emptyRules()});
  for(const contentId of ['word-company','word-light','sh54-word-even-though'])
    await f.call('parent-a','assignContent',{familyId:family.id,childId,contentId,date});
  const a=f.client('parent-a'),b=f.client('parent-b');await a.engine.sync(date);await b.engine.sync(date);
  for(const task of a.engine.viewDay(date).tasks)a.engine.enqueue(date,task.id,true);
  a.loseNextResponse();await a.engine.sync(date);await a.engine.sync(date);await b.engine.sync(date);
  assert.ok(b.engine.viewDay(date).tasks.every(t=>t.done));
  const status=await b.engine.getLearningStatus({childId});assert.equal(status.items.length,3);
  assert.ok(status.items.every(i=>i.learnedCount===1));
  assert.ok(!JSON.stringify(a.engine.snapshot().queue).includes('vocabularyRevision'));
});
