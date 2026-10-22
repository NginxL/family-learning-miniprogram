'use strict';
// Local preparation only. Does not generate audio, call a provider or deploy code.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const catalog = require('../shared/catalog');
const { narration } = require('../shared/narration');
const { libraryVoiceKey, speechContentKey, speechHash } = require('../shared/speech-profile');
const { validateSpeechAudio } = require('../cloudfunctions/familyApi/speech-library');
const kinds = new Set(['poetry', 'word', 'sentence', 'english-reading']);
function queue() {
  const seen = new Map();
  const grade = item => Math.min(...(item.gradeMappings || []).map(m => m.grade), 10);
  for (const item of [...catalog].filter(item => kinds.has(item.kind)).sort((a,b) => grade(a)-grade(b))) {
    const plan = narration(item), voiceKey = libraryVoiceKey(plan.language);
    plan.chunks.forEach((text, part) => {
      const key = speechContentKey(text, voiceKey), reference = { contentId: item.id, part };
      if (seen.has(key)) { seen.get(key).references.push(reference); return; }
      seen.set(key, { key, text, textHash: speechHash(text), language: plan.language, voiceKey,
        kind: item.kind, grade: grade(item), references: [reference], status: 'pending' });
    });
  }
  return [...seen.values()];
}
// A downloaded but uncertain file stays in review, not in the generation queue.
// Changed text/voice has a new key and is therefore eligible for a new recording.
function pendingQueue(ledgers = []) {
  const items = queue(), current = new Map(items.map(item => [item.key, item])), known = new Map();
  for (const ledger of ledgers) {
    assert.ok(Array.isArray(ledger.items), 'Invalid audio ledger');
    for (const entry of ledger.items) {
      assert.ok(['stored', 'review-pending'].includes(entry.status), 'Invalid audio ledger status');
      assert.equal(entry.key, speechContentKey(entry.text, entry.voiceKey), 'Invalid ledger identity');
      assert.equal(entry.textHash, speechHash(entry.text), 'Invalid ledger text hash');
      const target = current.get(entry.key);
      if (!target) continue;
      assert.equal(entry.language, target.language);
      if (known.get(entry.key) !== 'stored') known.set(entry.key, entry.status);
    }
  }
  return { totalSegments: items.length, storedSegments: [...known.values()].filter(x => x === 'stored').length,
    items: items.filter(item => !known.has(item.key)),
    reviewPending: items.filter(item => known.get(item.key) === 'review-pending') };
}
function validateBatch(manifest, directory) {
  assert.match(manifest.id, /^[a-zA-Z0-9_-]{1,80}$/);
  assert.ok(Array.isArray(manifest.items) && manifest.items.length > 0, 'Empty audio batch');
  const assets = new Map(queue().map(item => [item.key, item]));
  const seen = new Set();
  return manifest.items.map(item => {
    assert.equal(item.status, 'verified', `Not reviewed: ${item.file}`);
    assert.match(item.file, /^[a-zA-Z0-9_-]+\.mp3$/);
    assert.equal(seen.has(item.file), false, 'Duplicate file'); seen.add(item.file);
    assert.equal(item.voiceKey, libraryVoiceKey(item.language));
    const key = speechContentKey(item.text, item.voiceKey), target = assets.get(key);
    assert.ok(target, `Text is not an exact current public narration segment: ${item.file}`);
    assert.equal(item.textHash, target.textHash);
    assert.ok(Number.isFinite(item.duration) && item.duration > 0 && item.duration <= 120);
    assert.ok(item.review && Number.isFinite(item.verifiedAt) && item.verifiedAt > 0 && item.verifiedAt <= Date.now());
    const bytes = fs.readFileSync(path.join(directory, item.file));
    validateSpeechAudio(bytes.toString('base64'));
    assert.equal(item.bytes, bytes.length); assert.equal(item.digest, speechHash(bytes.toString('base64')));
    return { key, file: item.file, input: { text: target.text, textHash: target.textHash, voiceKey: target.voiceKey,
      language: target.language, references: target.references, batchId: manifest.id, bytes: bytes.length,
      digest: item.digest, duration: item.duration, review: item.review, verifiedAt: item.verifiedAt }, bytes };
  });
}
if (require.main === module) {
  const [command, filename, ...options] = process.argv.slice(2);
  if (command === 'queue' && filename) {
    const ledgers = [];
    for (let i = 0; i < options.length; i += 2) {
      assert.ok(options[i] === '--exclude' && options[i+1], 'Expected --exclude ledger.json');
      ledgers.push(JSON.parse(fs.readFileSync(options[i+1])));
    }
    const result = pendingQueue(ledgers);
    fs.writeFileSync(filename, JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), ...result }, null, 2));
    console.log(JSON.stringify({ segments: result.items.length, stored: result.storedSegments,
      reviewPending: result.reviewPending.length, characters: result.items.reduce((n,x)=>n+Array.from(x.text).length,0), output: filename }));
  } else if (command === 'validate' && filename) {
    const items = validateBatch(JSON.parse(fs.readFileSync(filename)), path.dirname(filename));
    console.log(JSON.stringify({ verified: items.length, bytes: items.reduce((n,x)=>n+x.bytes.length,0) }));
  } else throw Error('Usage: node scripts/speech-library.js queue output.json [--exclude ledger.json] | validate batch/manifest.json');
}
module.exports = { queue, pendingQueue, validateBatch };
