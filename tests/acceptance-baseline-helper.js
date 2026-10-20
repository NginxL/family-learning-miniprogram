const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/acceptance-baseline.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const patches = new Map(fixture.patches.map(patch => [patch.id, patch.fields]));

// Each reviewed display correction is reversible to the independently frozen
// 997576c catalogue. Older baselines keep their original hashes as well.
function beforeAcceptance(item) {
  const result = { ...item };
  for (const [field, patch] of Object.entries(patches.get(item.id) || {})) {
    if (!Object.hasOwn(result, field)) continue;
    assert.equal(hash(result[field]), patch.afterSha256, `Unreviewed acceptance change: ${item.id}.${field}`);
    if (Object.hasOwn(patch, 'before')) result[field] = patch.before;
    else delete result[field];
  }
  return result;
}
module.exports = { fixture, hash, beforeAcceptance };
