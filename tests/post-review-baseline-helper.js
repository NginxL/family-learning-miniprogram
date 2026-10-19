const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/post-review-baseline.json');
const { beforeCompletion } = require('./completion-baseline-helper');
const patches = new Map(fixture.patches.map(patch => [patch.id, patch.fields]));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Restore only the reviewed presentation fields for historical checks; keep their old hashes.
function beforePostReviewCorrections(item) {
  const result = beforeCompletion(item);
  for (const [field, patch] of Object.entries(patches.get(item.id) || {})) {
    if (!Object.hasOwn(result, field)) continue; // Caller may project away study/recitation metadata.
    assert.equal(hash(result[field]), patch.afterSha256, `Unreviewed change to ${item.id}.${field}`);
    if (Object.hasOwn(patch, 'before')) result[field] = patch.before;
    else delete result[field];
  }
  return result;
}
function identity(item) {
  const { id, kind, title, minutes, aliases, collections, bookIds, manualOnly, coveredContentIds, learningArea, gradeMappings } = item;
  return { id, kind, title, minutes, aliases, collections, bookIds, manualOnly, coveredContentIds, learningArea,
    gradeMappings: gradeMappings?.map(({ evidence, ...mapping }) => mapping) };
}
module.exports = { beforePostReviewCorrections, identity, hash };
