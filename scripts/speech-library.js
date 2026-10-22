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
  const [command, filename] = process.argv.slice(2);
  if (command === 'queue' && filename) {
    const items = queue(); fs.writeFileSync(filename, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items }, null, 2));
    console.log(JSON.stringify({ segments: items.length, characters: items.reduce((n,x)=>n+Array.from(x.text).length,0), output: filename }));
  } else if (command === 'validate' && filename) {
    const items = validateBatch(JSON.parse(fs.readFileSync(filename)), path.dirname(filename));
    console.log(JSON.stringify({ verified: items.length, bytes: items.reduce((n,x)=>n+x.bytes.length,0) }));
  } else throw Error('Usage: node scripts/speech-library.js queue output.json | validate batch/manifest.json');
}
module.exports = { queue, validateBatch };
