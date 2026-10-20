const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/completion-baseline.json');
const { beforeAcceptance } = require('./acceptance-baseline-helper');
const added = new Set(fixture.addedIds);
const patches = new Map(fixture.patches.map(patch => [patch.id, patch.fields]));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isPriorContent = item => !added.has(item.id);

// Constrain new presentation edits while retaining all independently recorded older hashes.
function beforeCompletion(item) {
  const result = beforeAcceptance(item);
  for (const [field, patch] of Object.entries(patches.get(item.id) || {})) {
    if (!Object.hasOwn(result, field)) continue;
    assert.equal(hash(result[field]), patch.afterSha256, `Unreviewed completion change: ${item.id}.${field}`);
    if (Object.hasOwn(patch, 'before')) result[field] = patch.before;
    else delete result[field];
  }
  return result;
}

function assertProgressDelta(progress) {
  const expected = structuredClone(fixture.beforeProgress);
  // The new excerpt replaces its full work at the same grade-two book position.
  // Two new grade-four practice cards have separately verified mappings.
  expected.grades[3].practice.total += 2;
  assert.deepEqual(progress, expected);
}
module.exports = { fixture, isPriorContent, beforeCompletion, assertProgressDelta, hash };
