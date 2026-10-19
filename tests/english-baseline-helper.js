// Only vocabulary presentation and its source wording are changed by the English review.
// All identities, placement, minutes, collections and non-word content remain constrained.
function withoutWordPresentation(item) {
  if (item.kind !== 'word') return item;
  const { detail, source, note, studyNotes, vocabularyRevision, dictionaryReference, commonSenseSources, ...stable } = item;
  if (stable.gradeMappings) stable.gradeMappings = stable.gradeMappings.map(({ evidence, ...mapping }) => mapping);
  return stable;
}
module.exports = { withoutWordPresentation };
