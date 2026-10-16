'use strict';
const data = require('../data/catalogs/shanghai-54-lower-primary.json');

function mapping(book, unit, type, page = unit.sourcePrintPage, pdfPage = unit.sourcePdfPage) {
  return { grade: book.grade, bookId: book.id, schoolSystem: '5-4', semester: book.semester,
    edition: book.edition, sourceUrl: book.sourceUrl, outlineDestination: pdfPage ? `#page=${pdfPage}` : `目录 Unit ${unit.number}，印刷页 ${page}`,
    sourceKind: book.sourceKind, sourcePrintPage: page, ...(pdfPage ? { sourcePdfPage: pdfPage } : {}),
    unit: `第${unit.number}单元 · ${unit.title}${unit.optional ? '（拓展）' : ''}`, unitId: unit.id, mappingType: type,
    evidence: type === 'aligned_practice' ? '按已核实单元主题自编；不是教材课文或课后原题。页码为所依据单元的起始位置，学校版次待确认。' : '教材公开样本字词与册次已核实；页码为目录标注的单元起始位置，学校版次待确认。',
    status: 'catalogue_verified' };
}
function attach(item, book, unit, type, word) {
  item.collections = [...new Set([...item.collections, 'shanghai54'])];
  item.bookIds = [...new Set([...(item.bookIds || []), book.id])];
  const location = item.studyArea === 'literacy'
    ? mapping(book, unit, type, unit.recognitionPrintPages?.[0] || unit.recognitionPdfPages[0] - (book.sourcePageOffset || 5), unit.recognitionPdfPages[0])
    : word?.wordBankPrintPage ? mapping(book, unit, type, word.wordBankPrintPage, word.wordBankPdfPage) : mapping(book, unit, type);
  if (item.studyArea === 'literacy') location.evidence = '识字、写字表按原书逐字核对；此页为该组识字表所在页，完整页码见字表说明。学校版次待确认。';
  if (word?.wordBankPrintPage) location.evidence = '卷末 Word bank 原页与目录主题词逐项核对；页码为该词所在的词表页。学校版次待确认。';
  if (word?.wordBankAudioTrack) {
    location.sourceUrl = book.sourceEvidence.officialResourceUrl;
    location.sourceKind = 'official_audio';
    location.outlineDestination = `Word bank / Unit ${unit.number}`;
    delete location.sourcePrintPage;
    delete location.sourcePdfPage;
    location.evidence = `官方配套 Word bank 音频：${word.wordBankAudioTrack}；提取码 ${book.sourceEvidence.officialResourceCode}；书号 ${book.sourceEvidence.officialResourceIsbn}。词项已与目录交叉核对，纸本词表页及学校印次待确认。`;
  }
  if (word?.verificationNote) location.evidence += ` ${word.verificationNote}`;
  item.gradeMappings = [...(item.gradeMappings || []), location];
}
function practiceDetail(practice, language) {
  return language === 'chinese'
    ? `${practice.body}\n\n想一想：${practice.question}\n\n参考：${practice.answer}\n\n练一练：${practice.skill}`
    : `${practice.body}\n\n中文提示：\n${practice.translation.join('\n')}\n\nRead and think:\n${practice.question}\n${practice.questionHint}\n\n参考：${practice.answer}`;
}
function literacyDetail(unit) {
  return `认一认：\n${unit.recognition.map(row => [...row].join(' ')).join('\n')}\n\n写一写：\n${unit.writing.map(row => [...row].join(' ')).join('\n')}\n\n练习：每次选一行，先读准，再遮住拼音认读。写字时观察笔画位置，选两个字组词。`;
}
function validate() {
  const ids = new Set();
  for (const book of data.books) {
    if (ids.has(book.id) || ![1, 2].includes(book.grade) || !['上册', '下册'].includes(book.semester)
      || book.schoolSystem !== '5-4' || !book.sourceUrl.startsWith('https://') || book.inventory.fullCoverage)
      throw Error(`Invalid lower-primary book: ${book.id}`);
    ids.add(book.id);
    const expected = book.subject === 'chinese' ? 8 : 10;
    if (book.units.length !== expected || !book.inventory.unitPracticeComplete) throw Error(`Incomplete unit inventory: ${book.id}`);
    if (book.inventory.wordBankComplete) {
      const bank = book.units.flatMap(unit => unit.wordBankEntries || []);
      if (bank.length !== book.inventory.wordBankCount || new Set(bank).size !== bank.length
        || book.units.some(unit => unit.wordBankEntries.some(text => !unit.words.some(word => word.text === text && (word.wordBankPrintPage || word.wordBankAudioTrack)))))
        throw Error(`Incomplete Word bank evidence: ${book.id}`);
    }
    for (const [index, unit] of book.units.entries()) {
      if (unit.number !== index + 1 || unit.id !== `u${index + 1}` || !unit.sourcePrintPage || !unit.title
        || unit.practice?.origin !== 'original' || !unit.practice.body || !unit.practice.question || !unit.practice.answer)
        throw Error(`Incomplete unit practice: ${book.id}/${unit.id}`);
      if (book.subject === 'chinese') {
        if (!book.inventory.recognitionComplete || !book.inventory.writingComplete) {
          if (unit.recognition || unit.writing) throw Error(`Unverified character inventory: ${book.id}/${unit.id}`);
          continue;
        }
        for (const type of ['recognition', 'writing']) {
          if (unit[type].length !== unit[type + 'Reading'].length || unit[type].some((row, i) => [...row].length !== unit[type + 'Reading'][i].split(' ').length))
            throw Error(`Misaligned character readings: ${book.id}/${unit.id}/${type}`);
        }
      } else if (!unit.words.length || unit.words.some(word => !word.text || !word.meaning)
        || unit.practice.body.split('\n').length !== unit.practice.translation.length) throw Error(`Incomplete English unit: ${book.id}/${unit.id}`);
    }
  }
}
function augment(items) {
  validate();
  const byId = new Map(items.map(item => [item.id, item]));
  const lexicon = new Map(items.filter(item => item.kind === 'word').flatMap(item => [item.title, ...(item.aliases || [])].map(word => [word, item])));
  // These variants are explicitly grouped under one national headword, not new knowledge IDs.
  for (const [alias, id] of [['mum', 'word-mother'], ['mom', 'word-mother'], ['dad', 'word-father']]) {
    if (byId.has(id)) lexicon.set(alias, byId.get(id));
  }
  const curatedMeanings = new Set();
  for (const book of data.books) for (const unit of book.units) {
    const add = (item, type) => {
      if (byId.has(item.id)) throw Error(`Duplicate lower-primary content: ${item.id}`);
      attach(item, book, unit, type); byId.set(item.id, item); items.push(item);
    };
    const prefix = `sh54-${book.subject === 'chinese' ? 'zh' : 'en'}-${book.grade}${book.semester === '上册' ? 'a' : 'b'}-${unit.id}`;
    if (book.subject === 'chinese') {
      if (book.inventory.recognitionComplete && book.inventory.writingComplete) add({ id: `${prefix}-literacy`, kind: 'reading', title: `识字写字 · 第${unit.number}组`, detail: literacyDetail(unit),
        source: '教材字表核实；按单元整理；练习提示自编', minutes: 10, collections: [], studyArea: 'literacy',
        referenceUrl: book.sourceUrl, note: `识字表电子书第 ${unit.recognitionPdfPages.join('、')} 页；写字表电子书第 ${unit.writingPdfPages.join('、')} 页。含多音字复习项，可分行学习。写字拼音为学习辅助。` }, 'textbook_item');
      add({ id: `${prefix}-reading`, kind: 'reading', title: unit.practice.title, detail: practiceDetail(unit.practice, 'chinese'),
        source: '原创语文阅读与练习 · 依据已核实单元主题编写', minutes: 8, collections: [], studyArea: unit.practice.area,
        referenceUrl: book.sourceUrl, note: '短文、提问与参考答案自编，不是教材课文或标准答案；拼音为阅读辅助。' }, 'aligned_practice');
    } else {
      for (const word of unit.words) {
        let item = lexicon.get(word.text);
        if (!item) {
          const id = `sh54-word-${word.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
          item = { id, kind: 'word', title: word.text, detail: `${word.text}\n${word.meaning}`, minutes: 1,
            source: word.wordBankAudioTrack ? '沪教版官方配套 Word bank 音频；常用义提示自编' : '沪教版教材目录 Topic words；常用义提示自编',
            collections: [], aliases: [word.text], referenceUrl: word.wordBankAudioTrack ? book.sourceEvidence.officialResourceUrl : book.sourceUrl };
          if (byId.has(id)) throw Error(`Ambiguous vocabulary identity: ${word.text}`);
          byId.set(id, item); lexicon.set(word.text, item); items.push(item);
        }
        // Keep canonical IDs so earlier learning prevents a duplicate new-word task.
        item.aliases = [...new Set([...(item.aliases || []), word.text])];
        if (!curatedMeanings.has(item.id)) {
          item.detail = `${item.title}\n${word.meaning}`;
          item.source = `${item.source.split('；')[0]}；教材主题常用义自编`;
          item.note = '中文为该主题下的常用义提示，不是完整词典释义或教材译文。';
          curatedMeanings.add(item.id);
        }
        attach(item, book, unit, 'textbook_item', word);
      }
      for (const [i, sentence] of unit.practice.body.split('\n').entries()) add({
        id: `${prefix}-sentence-${i + 1}`, kind: 'sentence', title: sentence,
        detail: `${sentence}\n${unit.practice.translation[i]}\n\n读一读，再换一个人物或物品说一说。`,
        source: '原创口语例句 · 依据已核实单元主题编写', minutes: 3, collections: [], referenceUrl: book.sourceUrl
      }, 'aligned_practice');
      add({ id: `${prefix}-reading`, kind: 'english-reading', title: unit.practice.title,
        detail: practiceDetail(unit.practice, 'english'), source: '原创英语短文、中文提示与读后问答 · 非教材课文',
        minutes: 5, collections: [], referenceUrl: book.sourceUrl }, 'aligned_practice');
    }
  }
  return items;
}
function pinyin() {
  const entries = {};
  for (const book of data.books.filter(book => book.subject === 'chinese')) for (const unit of book.units) {
    const prefix = `sh54-zh-${book.grade}${book.semester === '上册' ? 'a' : 'b'}-${unit.id}`;
    if (book.inventory.recognitionComplete && book.inventory.writingComplete) entries[`${prefix}-literacy`] = { title: `识字写字 · 第${unit.number}组`, detail: literacyDetail(unit), titleReading: 'shí zì xiě zì dì zǔ',
      detailReading: `rèn yī rèn ${unit.recognitionReading.join(' ')} xiě yī xiě ${unit.writingReading.join(' ')} liàn xí měi cì xuǎn yī háng xiān dú zhǔn zài zhē zhù pīn yīn rèn dú xiě zì shí guān chá bǐ huà wèi zhì xuǎn liǎng gè zì zǔ cí` };
    const p = unit.practice;
    entries[`${prefix}-reading`] = { title: p.title, detail: practiceDetail(p, 'chinese'), titleReading: p.titleReading, detailReading: p.detailReading };
  }
  return entries;
}
function bookSummaries() {
  return data.books.map(book => ({ id: book.id, title: book.title, grade: book.grade, semester: book.semester,
    subject: book.subject, url: book.sourceUrl, verification: `${book.edition}；学校采用版次待确认。`,
    units: book.units.map(unit => ({ id: unit.id, label: `第${unit.number}单元 · ${unit.title}${unit.optional ? '（拓展）' : ''}` })) }));
}
module.exports = { data, augment, pinyin, bookSummaries, practiceDetail, literacyDetail };
