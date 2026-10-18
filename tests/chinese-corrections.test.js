const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const learning = require('../shared/learning');
const { decorate } = require('../miniprogram/lib/page');
const { withContentSources } = require('../miniprogram/lib/content-presentation');
const revisions = require('../data/catalogs/chinese-text-revisions.json');
const recitations = require('../data/catalogs/chinese-recitation-requirements.json').entries;
const evidence = require('../data/catalogs/chinese-recitation-page-evidence.json').pages;
const guides = require('../data/catalogs/chinese-classical-details.json').entries;
const lessons = require('../data/catalogs/chinese-foundation-system.json').lessons;
const { beforeChineseCorrections } = require('./chinese-baseline-helper');
const prefix = 'moe-2022-zh-7-9-';
const primary = 'moe-2022-zh-1-6-';
const item = id => learning.catalogById.get(id);
const body = id => { const value = item(id); return value.detail.slice(value.author.length + 1); };

test('text corrections use the verified textbook characters, punctuation and paragraphs', () => {
  for (const [id, expected, rejected] of [
    ['sh54-advice-son', '不能治性', '不能冶性'],
    [prefix+'029', '自缘身在最高层', '只缘身在最高层'],
    [prefix+'047', '能谤议于市朝', '能谤讥于市朝'],
    [prefix+'042', '故克之。夫大国', '故克之，夫大国'],
    [prefix+'058', '藻、荇交横', '藻荇交横'],
    [prefix+'041', '饭疏食，饮水', '饭疏食饮水'],
    [prefix+'009', '乡书何处达，', '乡书何处达？'],
    [prefix+'008', '独怆然而涕下！', '独怆然而涕下。'],
    [prefix+'057', '宜乎众矣。', '宜乎众矣！'],
    [prefix+'023', '隔江犹唱后庭花。', '隔江犹唱《后庭花》。']
  ]) { assert.ok(body(id).includes(expected), id); assert.ok(!body(id).includes(rejected), id); }
  assert.match(item(prefix+'047').textRevision.summary, /旧版九下作“谤讥”/);
  // The current original page says 耀; an alternate reading in its note is not the main text.
  assert.ok(body(prefix+'055').includes('日星隐耀'));
  assert.ok(body(prefix+'055').endsWith('乎！噫！微斯人，吾谁与归？时六年九月十五日。'));
  assert.ok(body(prefix+'040').includes('早又是中秋佳节'));
  assert.ok(body(prefix+'040').includes('身不得，男儿列，心却比，男儿烈。'));
  assert.equal(body(prefix+'006').split('\n\n')[0],'唧唧复唧唧，木兰当户织。不闻机杼声，唯闻女叹息。');
  assert.equal(body('sh54-archery').split('\n\n').length,2);
  for (const [id, count] of [['sh54-mengzi-dedao',1], ['sh54-mengzi-youhuan',2], [prefix+'058',1], [prefix+'048',8], [prefix+'055',5]])
    assert.equal(body(id).split(/\n+/).length, count, id);
  for (const r of revisions.entries) {
    assert.equal(createHash('sha256').update(body(r.contentId)).digest('hex'), r.originalSha256, r.contentId);
    assert.ok(r.pages.every(p => /https:\/\/(basic.smartedu.cn|book.pep.com.cn)\//.test(p.sourceUrl) && /^[a-f0-9]{64}$/.test(p.sha256)));
  }
  assert.equal(learning.catalog.filter(i=>i.textRevision).length,22,'19 original texts and 3 independent classical lessons');
});

test('Song Dongyang recitation includes the complete second paragraph while preserving excerpt identity', () => {
  const id = 'sh54-songdongyang-textbook', full = body(id).split('\n\n'), short = body(prefix+'059').split('\n\n');
  assert.equal(full.length,4); assert.equal(short.length,2);
  assert.deepEqual(short,full.slice(0,2));
  assert.ok(full[1].includes('盖余之勤且艰若此。今虽耄老'));
  assert.ok(full[1].endsWith('况才之过于余者乎？'));
  assert.ok(full[2].startsWith('今诸生学于太学'));
  const r = recitations.find(r => r.contentId === id);
  assert.equal(r.end,'况才之过于余者乎？');
  assert.equal(body(id).slice(body(id).indexOf(r.start),body(id).indexOf(r.end)+r.end.length),full.slice(0,2).join('\n\n'));
});

test('39 missing requirements have specific original pages without transferring dictation across editions', () => {
  // Expected works/pages independently transcribed from the original requirement pages.
  const expected = [
    ['chinese-2b-sample',3,9,['poem-willow',primary+'075']],
    ['chinese-2b-sample',71,77,[primary+'025',primary+'064']],
    ['chinese-5a-sample',53,58,[primary+'059',primary+'067',primary+'074']],
    ['chinese-5a-sample',93,98,[primary+'029','sh54-shanju-qiuming',primary+'034']],
    ['chinese-5a-sample',103,108,['sh54-guren-dushu-lunyu','sh54-guren-dushu-zhuxi']],
    ['chinese-7a',65,72,[prefix+'041']], ['chinese-7a',92,99,['sh54-advice-son']],
    ['chinese-7b',113,120,[prefix+'053',prefix+'057']],
    ['chinese-8a',66,73,[prefix+'050',prefix+'058']],
    ['chinese-8a',147,154,['sh54-mengzi-dedao','sh54-mengzi-youhuan','sh54-mengzi-fugui']],
    ['chinese-8a',150,157,['sh54-yugong-yishan']],
    ['chinese-8a',157,164,['005','015','021','022','032'].map(n=>prefix+n)],
    ['chinese-8b',136,143,[prefix+'044']], ['chinese-9a',141,148,[prefix+'047']],
    ['chinese-9a',153,160,['003','017','034','036','038'].map(n=>prefix+n)],
    ['chinese-9b',61,68,['027','030','035','040'].map(n=>prefix+n)], ['chinese-9b',128,135,[prefix+'047']]
  ];
  assert.equal(expected.reduce((n,row)=>n+row[3].length,0),39);
  const added = recitations.slice(99);
  assert.deepEqual(added.map(r=>`${r.bookId}:${r.contentId}`).sort(),expected.flatMap(([book,,,ids])=>ids.map(id=>`${book}:${id}`)).sort());
  for (const [book,pr,pdf,ids] of expected) for(const id of ids) {
    const r = added.find(r=>r.bookId===book && r.contentId===id);
    assert.equal(r.sourcePrintPage,pr);assert.equal(r.sourcePdfPage,pdf);
    const page = evidence.find(p=>p.bookId===book && p.sourcePdfPage===pdf);
    assert.ok(page.contentIds.includes(id));assert.ok(page.requirementQuote);assert.match(page.sha256,/^[a-f0-9]{64}$/);
  }
  const familiar = added.filter(r=>r.requirement==='熟读成诵');assert.equal(familiar.length,6);
  for (const n of ['003','017','034','036','038']) {
    assert.equal(recitations.find(r=>r.bookId==='chinese-9a' && r.contentId===prefix+n).requirement,'熟读成诵');
    assert.equal(recitations.find(r=>r.bookId==='chinese-9b' && r.contentId===prefix+n).requirement,'背诵并默写全文');
  }
  const limited = added.find(r=>r.contentId==='sh54-mengzi-fugui');
  assert.equal(limited.requirement,'背诵指定范围');assert.equal(limited.start,'居天下之广居，');assert.equal(limited.end,'此之谓大丈夫。');
  assert.ok(!recitations.some(r=>r.contentId==='sh54-caochong' || r.contentId==='sh54-tiechu'));
});

test('corrected glosses retain their context and agree with independent practice explanations', () => {
  const expected = [
    [prefix+'058','盖','大概是'], [prefix+'049','鲜美','新鲜美好'], [prefix+'054','清冽','清澈'],
    ['sh54-hezhouji','不属','不相关联'],[prefix+'056','临','居高面下'],[prefix+'042','情','诚心'],
    [prefix+'052','只','只是'],[prefix+'052','策','用马鞭驱赶'],['sh54-dadao-zhixing','修','修治'],
    ['sh54-tangju-buru','色挠','面露胆怯之色'],[prefix+'053','白丁','没有功名'],['sh54-caochong','校','计数'],
    ['sh54-guren-dushu-lunyu','敏（敏而好学）','聪敏'],['sh54-guren-dushu-lunyu','敏（敏以求之）','勤勉']
  ];
  for(const [id,term,meaning] of expected) {
    const g = guides.find(g=>g.contentId===id), word = g.words.find(w=>w.text===term);
    assert.ok(word.meaning.includes(meaning),`${id}/${term}`);assert.ok(g.textbookEvidence.length);
    assert.ok(item(id).studyNotes.sources.some(s=>s.title.includes('核验原书')));
  }
  const wolf = guides.find(g=>g.contentId==='sh54-wolf');
  assert.match(wolf.sentences[1].meaning,/大概/);assert.match(wolf.words.find(w=>w.text==='盖').meaning,/一说/);
  assert.ok(!guides.find(g=>g.contentId===prefix+'052').words.some(w=>w.text==='祗'));
  for (const [id,term] of [['sh54-caochong','校'],['sh54-dadao-zhixing','修'],[prefix+'042','情'],[prefix+'052','策']]) {
    const meaning = guides.find(g=>g.contentId===id).words.find(w=>w.text===term).meaning;
    const practice = lessons.find(l=>l.id===`skill-zh-${id}`);
    assert.ok(practice.explanation.includes(`${term}：${meaning}`),`${id}/${term}: guide/practice conflict`);
  }
  const chenshe = guides.find(g=>g.contentId==='sh54-chenshe-shijia');
  assert.match(chenshe.structure,/谋划起义/);assert.match(chenshe.pitfall,/杀之以应陈涉/);
});

test('official second-grade source and eighth-grade page fixes retain grade and unit associations', () => {
  for(const [id,pr,pdf,unit] of [['poem-willow',1,7,'u1'],[primary+'075',2,8,'u1'],[primary+'025',69,75,'u6'],[primary+'064',70,76,'u6']]) {
    const mappings=item(id).gradeMappings.filter(m=>m.bookId==='chinese-2b-sample');assert.equal(mappings.length,1);
    const m=mappings[0];assert.equal(m.grade,2);assert.equal(m.semester,'下册');assert.equal(m.unitId,unit);
    assert.equal(m.sourcePrintPage,pr);assert.equal(m.sourcePdfPage,pdf);assert.equal(new URL(m.sourceUrl).hostname,'book.pep.com.cn');
    assert.equal(m.sourceKind,'official_textbook');
  }
  for(const [id,pr,pdf] of [[prefix+'015',155,162],[prefix+'022',156,163]]) {
    const m=item(id).gradeMappings.find(m=>m.bookId==='chinese-8a');assert.equal(m.sourcePrintPage,pr);assert.equal(m.sourcePdfPage,pdf);
  }
});

test('recitation summaries have one grade prefix and keep edition-specific scope', () => {
  const song=withContentSources(decorate(item('sh54-songdongyang-textbook')));
  assert.equal(song.recitationSummary,'九年级下册（旧版参考）：背诵前两段（余幼时即嗜学。—况才之过于余者乎？）');
  const crossing=withContentSources(decorate(item(prefix+'036'))).recitationSummary.split('\n');
  assert.deepEqual(new Set(crossing),new Set(['九年级上册：熟读成诵','九年级下册（旧版参考）：背诵并默写全文']));
  assert.ok(crossing.every(line=>line.split('：').length===2));
});

test('old completed and planned texts show correction without rewriting stored tasks or history', () => {
  const current=item('sh54-advice-son'), legacy=beforeChineseCorrections(current), oldBody=legacy.detail;
  const task={...learning.taskFrom(legacy,'child','old-task','manual'),done:true};
  const ledger={records:{}}; learning.recordTasks(ledger,[task],'2026-10-12');ledger.records[current.id].mastered=true;
  const day={date:'2026-10-12',tasks:[task]},family={children:[{id:'child'}],plans:[],autoPlans:{child:learning.emptyRules()}};
  const before=JSON.stringify({tasks:day.tasks,ledger});
  const display=withContentSources(decorate(task));
  assert.equal(display.detail,oldBody);assert.match(display.textCorrectionNotice,/正文已校订/);assert.match(display.correctedDetail,/不能治性/);
  assert.match(withContentSources(decorate({...task,done:false})).textCorrectionNotice,/正文已校订/);
  learning.generateDay(family,day,{child:ledger},true);
  assert.equal(JSON.stringify({tasks:day.tasks,ledger}),before);
  assert.ok(!before.includes('textRevision') && !before.includes('correctedDetail'));
  const status=learning.learningStatus(ledger).items.find(i=>i.contentId===current.id);assert.equal(status.learnedCount,1);assert.equal(status.mastered,true);
  for (const fresh of [current,learning.taskFrom(current,'child','new-task','manual')]) {
    assert.equal(withContentSources(decorate(fresh)).textCorrectionNotice,'');assert.equal(withContentSources(decorate(fresh)).correctedDetail,'');
  }
  const custom=withContentSources(decorate({id:'custom',title:current.title,kind:'poetry',detail:oldBody}));assert.equal(custom.textRevision,undefined);
  assert.equal(withContentSources(decorate({...learning.taskFrom(item('word-read'),'child','old-word','manual'),detail:'旧词义'})).textCorrectionNotice,'');
  for (const id of ['skill-zh-sh54-caochong','skill-zh-sh54-dadao-zhixing','skill-zh-'+prefix+'042']) {
    const currentLesson=item(id), legacyLesson=beforeChineseCorrections(currentLesson);
    const oldTask={...learning.taskFrom(legacyLesson,'child',`old-${id}`,'manual'),done:true};
    const snapshot=JSON.stringify(oldTask), view=withContentSources(decorate(oldTask));
    assert.match(view.textCorrectionNotice,/正文已校订/);assert.equal(view.correctedDetail,currentLesson.detail);
    assert.equal(JSON.stringify(oldTask),snapshot);
    assert.equal(withContentSources(decorate(currentLesson)).textCorrectionNotice,'');
  }
});
