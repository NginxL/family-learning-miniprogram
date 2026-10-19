const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const learning = require('../shared/learning');
const knowledge = require('../shared/knowledge-data.json');
const { books } = require('../scripts/lower-primary').data;
const grammar = require('../data/catalogs/english-foundation-system.json').lessons;
const common = require('../data/catalogs/english-high-frequency-senses.json');
const requirements = require('../data/catalogs/chinese-recitation-requirements.json').entries;
const pages = require('../data/catalogs/chinese-recitation-page-evidence.json').pages;
const baseline = require('./fixtures/post-review-baseline.json');
const { beforePostReviewCorrections, identity, hash } = require('./post-review-baseline-helper');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const { decorate } = require('../miniprogram/lib/page');
const get = id => learning.catalogById.get(id);
const word = head => learning.catalog.find(item => item.kind === 'word' && [item.title, ...(item.aliases || [])].includes(head));
const practice = (book, unit) => books.find(b => b.id === book).units.find(u => u.id === unit).practice;

test('post-review corrections preserve IDs, placement, excerpt coverage and seven legacy books', () => {
  assert.equal(knowledge.length, baseline.knowledgeCount);
  assert.equal(learning.catalog.length, baseline.catalogCount);
  // The reviewed field patch must match exactly; a broad regenerated catalogue hash is not sufficient.
  assert.equal(hash(learning.catalog.map(beforePostReviewCorrections).map(identity)), baseline.identitySha256);
  const changed = get('skill-en-question-tags').gradeMappings[0];
  assert.equal(changed.unitId, 'u6'); assert.equal(changed.grade, 6); assert.equal(changed.semester, '上册');
  assert.equal(get('skill-en-question-tags').manualOnly, true);
  assert.equal(books.filter(book => book.editionStatus === 'historical_reference').length, 7);
  assert.equal(requirements.length, 138);
});

test('reviewed common senses are independent of unit-only meanings and include dictionary links', () => {
  const expected = { above: '在……上方', appear: '出现', just: '刚刚', order: '顺序', ring: '戒指', pass: '及格', date: '约会', character: '性格',
    hit: '击打', beat: '打败', fair: '公平的', mark: '分数', wave: '挥手', figure: '数字', stage: '阶段',
    cover: '封面', novel: '新奇的', general: '将军' };
  assert.deepEqual(Object.keys(common.entries).sort(), Object.keys(expected).sort());
  for (const [head, meaning] of Object.entries(expected)) {
    const item = word(head), section = item.detail.match(/常用义：\n([\s\S]*?)(?:\n\n|$)/)?.[1];
    assert.ok(section?.includes(meaning), head); assert.equal(item.vocabularyRevision, '2026-10-19');
    assert.ok(item.commonSenseSources.length); assert.deepEqual(withContentSources(decorate(item)).commonSenseSources, item.commonSenseSources);
    for (const source of item.commonSenseSources) assert.ok(['www.collinsdictionary.com', 'dictionary.cambridge.org'].includes(new URL(source.url).hostname));
  }
  for (const [head, unitOnly] of [['fair','白皙'],['figure','计算'],['beat','搅拌'],['hit','达到']]) {
    const item = word(head); assert.ok(item.detail.includes(unitOnly), head);
    assert.ok(!item.detail.match(/常用义：\n([\s\S]*?)(?:\n\n|$)/)[1].includes(unitOnly), head);
  }
  // A builder-level guard catches the root cause, including a newly introduced book-only word.
  const v = require('../scripts/english-vocabulary'), state = new Map();
  const bookOnly = { id:'probe',kind:'word',title:'probe',detail:'probe\n单元提示',source:'教材样本',collections:[],aliases:['probe'] };
  v.collect(bookOnly,{text:'probe',meaning:'单元提示'},state);v.finish([bookOnly],state);
  assert.doesNotMatch(bookOnly.detail,/常用义/);assert.match(bookOnly.detail,/单元学习提示（自编，原页义项待核实）/);
});

test('same-POS duplicate meanings do not repeat while noun and verb senses remain distinct', () => {
  assert.equal(word('match').detail.split('比赛').length - 1, 1);
  assert.equal(word('mean').detail.split('意思是').length - 1, 1);
  assert.match(word('light').detail, /v\. 点燃/);assert.match(word('light').detail,/adj\. 轻的；浅色的/);
  assert.match(word('company').studyNotes.exercises[0].question,/company「公司」的/);
  assert.doesNotMatch(word('homework').studyNotes.exercises[0].question,/（（|））/);
});

test('above and appear show reviewed common senses while retaining original unit meanings and inflection scope', () => {
  for (const [head, expected, unitMeaning] of [
    ['above', ['prep. 在……上方；超过（数量或水平）', 'adv. 在上面；在上文'], 'adv. （水平）超过，更多，更大'],
    ['appear', ['v. 出现；显得；似乎'], 'v. 显得；看来；似乎']
  ]) {
    const item = word(head), section = item.detail.match(/常用义：\n([\s\S]*?)(?:\n\n|$)/)?.[1];
    for (const line of expected) assert.ok(section?.includes(line), `${head}: ${line}`);
    assert.ok(item.detail.includes(unitMeaning));
    assert.equal(item.commonSenseSources[0].url, `https://www.collinsdictionary.com/dictionary/english/${head}`);
    assert.ok(item.dictionaryReference, 'unreviewed dictionary reference is retained separately');
  }
  assert.match(word('appear').studyNotes.exercises[0].question, /appear「显得；看来；似乎」/);
  assert.equal(word('appear').studyNotes.exercises[0].answer, 'appeared');
});

test('grade-three upper recitation evidence stays explicitly provisional until official pages are reviewed', () => {
  const entries = requirements.filter(r => r.bookId === 'chinese-3a-sample');
  assert.equal(entries.length, 7);
  for (const r of entries) {
    assert.equal(r.sourceUrl, 'https://keben.app/book/0357');
    assert.match(r.evidence, /第三方样本.*官方原页待复核/);
    assert.equal(r.sourcePdfPage - r.sourcePrintPage, 5);
    const item = get(r.contentId), mapping = item.gradeMappings.find(m => m.bookId === r.bookId);
    assert.equal(mapping.sourceKind, 'public_sample'); assert.equal(mapping.grade, 3); assert.equal(mapping.semester, '上册');
    assert.deepEqual(item.recitationRequirements.find(e => e.bookId === r.bookId), { ...r, label: `3年级上册：${r.requirement}` });
    const source = withContentSources(decorate(item));
    assert.match(source.sourceGradeLabel, /官方原页待核实/);
  }
  assert.deepEqual(entries.map(r => r.sourcePrintPage), [15, 15, 15, 85, 85, 85, 96]);
  assert.equal(entries.filter(r => r.requirement === '背诵并默写全文').length, 2);
  const document = fs.readFileSync('docs/背诵要求与逐篇辅助核验.md', 'utf8');
  assert.ok(document.includes('| 3年级上册 | 11 | 7 | 第三方样本要求；官方原页待复核 |'));
});

test('original vocabulary pages distinguish expressions and restore acronym word boundaries', () => {
  for (const [book, head, page, expected] of [
    ['english-3a-2026',"It's great to see you again.",89,null],['english-4a-2026','See you soon',87,null],
    ['english-6a-2024','ICT',134,'information and communications technology'],
    ['english-9a-2024','CBD',134,'central business district'],['english-9a-2024','ROV',135,'remotely-operated vehicle']
  ]) {
    const w=books.find(b=>b.id===book).units.flatMap(u=>u.words).find(w=>w.text===head);
    assert.equal(w.vocabularyPrintPage,page);
    if(expected===null)assert.equal(w.textbookSenses[0].partOfSpeech,null);
    else assert.ok(w.textbookSenses[0].meaning.includes(expected));
  }
});

test('grammar goals, evidence and open answers match their stated learning scope', () => {
  for(const lesson of grammar.filter(l=>l.level==='understanding')) {
    assert.match(lesson.goal,/辨认.*理解/);assert.doesNotMatch(lesson.goal,/辨别并运用/);
  }
  const tags=grammar.find(l=>l.id==='skill-en-question-tags');assert.equal(tags.curriculumPdfPage,undefined);
  assert.equal(tags.textbookEvidence[0].unitId,'u6');assert.doesNotMatch(get(tags.id).source,/课标电子|undefined/);
  assert.equal(get(tags.id).referenceUrl,get(tags.id).gradeMappings[0].sourceUrl);
  assert.match(get('skill-en-must').detail,/询问是否有必要/);
  const concession=grammar.find(l=>l.id==='skill-en-concession').exercises[0].answer;
  assert.ok(concession.includes('Although he was tired, he kept reading.'));
  assert.ok(concession.includes('He was tired, but he kept reading.'));
  assert.match(get('skill-en-numerals').detail,/page five.*基数词/);
  for(const id of ['present-continuous','better-need','imperatives','there-be','reason-clauses','concession','passive-future']) {
    const question = grammar.find(l => l.id === 'skill-en-' + id).exercises.find(e => e.question.startsWith('改错：')).question;
    assert.match(question, /\.$/); assert.doesNotMatch(question, /。/);
  }
  assert.equal(grammar.find(l => l.id === 'skill-en-be').exercises[0].question, 'My friends ___ here. 填am/is/are。');
});

test('corrected original reading tasks agree with the passage and allow all requested passive examples', () => {
  assert.equal(practice('english-1a-sample','u10').translation[2],'现在我有六颗星星了。');
  assert.equal(practice('english-6a-2024','u4').translation[0],'我们的篮球队以两分之差输掉了首场比赛。');
  assert.match(practice('english-7a-2024','u1').question,/Who is asked to explain/);
  assert.match(practice('english-8a-2024','u2').grammar,/had没有人称、数的变化/);
  assert.match(practice('english-8a-2024','u3').grammar,/不是choose to do结构/);
  const p=practice('english-9a-2024','u5');
  for(const answer of ['was built','was checked','were added','was kept']) {assert.ok(p.body.includes(answer));assert.ok(p.answer.includes(answer));}
  assert.match(p.answer,/Any two/);
});

test('source disclosure distinguishes third-party samples and displays PDF-only grammar evidence', () => {
  let samples=0;
  for(const item of knowledge) {
    const view=withContentSources(decorate(item));
    for(const mapping of view.sourceMappings.filter(m=>m.sourceKind==='public_sample')) {
      samples++;assert.match(mapping.verificationLabel,/第三方样本/);assert.match(mapping.evidence,/官方原页.*待核实/);
      assert.doesNotMatch(view.sourceGradeLabel,/归属已核实/);
    }
  }
  assert.equal(samples,286);
  const tag=withContentSources(decorate(get('skill-en-question-tags')));
  assert.equal(tag.sourceMappings[0].sourcePdfPage,10);assert.equal(tag.sourceMappings[0].sourcePrintPage,undefined);
  const template=fs.readFileSync('miniprogram/templates/content-sources.wxml','utf8');
  assert.ok(template.includes('mapping.sourcePrintPage || mapping.sourcePdfPage'));
  for(const id of ['moe-2022-zh-7-9-050','moe-2022-zh-7-9-058']) {
    const r=requirements.find(r=>r.contentId===id&&r.bookId==='chinese-8a');
    assert.match(r.evidence,/朗读并背诵课文。/);assert.equal(r.sourcePdfPage,73);
  }
  assert.equal(pages.find(p=>p.bookId==='chinese-8a'&&p.sourcePdfPage===73).requirementQuote,'朗读并背诵课文。');
});

test('1.1.0 snapshots retain completion and mastery while corrected details remain read-only', () => {
  for(const old of baseline.oldTasks) {
    const task={...learning.taskFrom(old,'child','old-'+old.id,'manual'),done:true};
    const ledger={records:{}};learning.recordTasks(ledger,[task],'2026-10-18');ledger.records[old.id].mastered=true;
    const before=JSON.stringify({task,ledger}),view=withContentSources(decorate(task));
    assert.equal(view.detail,old.detail);
    if (old.detail !== get(old.id).detail) {
      assert.ok(view.textCorrectionNotice);assert.equal(view.correctedDetail,get(old.id).detail);
    } else {
      assert.equal(view.textCorrectionNotice,'');assert.equal(view.correctedDetail,'');
    }
    assert.equal(JSON.stringify({task,ledger}),before);
    const status=learning.learningStatus(ledger).items.find(i=>i.contentId===old.id);
    assert.equal(status.learnedCount,1);assert.equal(status.mastered,true);
    const fresh=learning.taskFrom(get(old.id),'child','new','manual');
    assert.equal(withContentSources(decorate(fresh)).textCorrectionNotice,'');
    assert.doesNotMatch(JSON.stringify(fresh),/commonSenseSources|contentRevision|vocabularyRevision/);
  }
});
