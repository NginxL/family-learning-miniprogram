'use strict';
// Presentation-only additions: never rewrite stored task text or the shared catalogue.
const pronunciations = require('../data/catalogs/english-pronunciations.json');
const overrides = require('../data/catalogs/english-pronunciation-overrides.json');
const core = require('../data/catalogs/english-dictionary-core.json');
const basic = require('../data/catalogs/english-dictionary-basic-pos.json');
const wordStudy = require('../data/catalogs/english-word-study.json');

function wordDictionaryData(catalog) {
  const entries = {};
  for (const item of catalog.filter(item => item.kind === 'word')) {
    const head = item.title.split(' (')[0];
    const supplement = core.entries[head] || (basic.entries[head] ? { ...basic.entries[head], sources: [basic.source] } : null);
    const override = overrides.entries[item.id];
    const sounds = override ? override.pronunciations : pronunciations.entries[item.id] || [];
    const sources = override ? [override.source] : [...new Set(sounds.map(row => row.sourceId))]
      .map(id => ({ title: pronunciations.sources[id].title, url: pronunciations.sources[id].url }));
    const forms = wordStudy.entries.find(entry => entry.contentId === item.id)?.forms || [];
    entries[item.id] = {
      pronunciations: sounds.map(({ headword, accent, ipa, usage }) => ({ headword, accent, ipa, ...(usage ? { usage } : {}) })),
      senses: supplement?.senses || [],
      sources: [...sources, ...(supplement?.sources || [])],
      // Each form stays bound to the POS/meaning reviewed in the original study supplement.
      forms: forms.map(({ label, value, sense }) => ({ label, value, pos: sense.partOfSpeech, meaning: sense.meaning }))
    };
  }
  return entries;
}
module.exports = { wordDictionaryData };
