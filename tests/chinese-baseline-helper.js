const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/chinese-corrections-baseline.json');
const patches = new Map(fixture.patches.map(patch => [patch.id, patch.fields]));
const { beforePostReviewCorrections } = require('./post-review-baseline-helper');

// Keep the independently recorded pre-review hashes, allowing only these reviewed changes.
function beforeChineseCorrections(item) {
  const { textRevision, ...result } = beforePostReviewCorrections(item);
  for (const [field, change] of Object.entries(patches.get(item.id) || {})) {
    if (!Object.hasOwn(result, field)) continue;
    const hash = createHash('sha256').update(JSON.stringify(result[field])).digest('hex');
    assert.equal(hash, change.afterSha256, `Unreviewed change to ${item.id}.${field}`);
    result[field] = change.before;
  }
  return result;
}
module.exports = { beforeChineseCorrections };
