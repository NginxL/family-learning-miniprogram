'use strict';
const { createHash } = require('node:crypto');
const revisions = require('../data/catalogs/chinese-text-revisions.json');

// A display-only revision marker. Existing tasks and learning records are never rewritten.
function augment(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const used = new Set();
  for (const revision of revisions.entries) {
    const item = byId.get(revision.contentId);
    const original = item?.detail.slice((item.author || '').length + 1);
    if (item?.kind !== 'poetry' || used.has(item.id) || !revision.pages.length
      || createHash('sha256').update(original).digest('hex') !== revision.originalSha256)
      throw Error(`Unverified text revision: ${revision.contentId}`);
    used.add(item.id);
    const page = revision.pages[0];
    item.textRevision = { checkedAt: revision.checkedAt, summary: revision.summary,
      sourceUrl: page.sourceUrl, sourcePrintPages: revision.pages.map(p => p.sourcePrintPage),
      sourcePdfPages: revision.pages.map(p => p.sourcePdfPage) };
  }
  return items;
}
module.exports = { augment };
