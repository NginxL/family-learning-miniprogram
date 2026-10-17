import type { KnowledgeItem } from './models';

function requireField(condition: unknown, path: string): asserts condition {
  if (!condition) throw new Error(`Invalid knowledge data: ${path}`);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const kinds = ['poetry', 'word', 'sentence', 'english-reading', 'reading', 'math', 'other'];
const scopes = ['starter', 'foundation', 'moe-all', 'tables', 'shanghai54', 'shanghai-exam', 'all'];

// JSON has no static types. Check structure before declaring the generated module typed.
// Curriculum evidence still needs independent factual verification.
export function assertKnowledge(value: unknown): asserts value is KnowledgeItem[] {
  requireField(Array.isArray(value), 'root must be an array');
  const ids = new Set<string>();
  value.forEach((item: unknown, index: number) => {
    const path = `items[${index}]`;
    requireField(object(item), path);
    for (const key of ['id', 'title', 'detail', 'source']) requireField(typeof item[key] === 'string' && item[key].length > 0, `${path}.${key}`);
    requireField(typeof item.id === 'string' && !ids.has(item.id), `${path}.id must be unique`);
    ids.add(item.id);
    requireField(typeof item.kind === 'string' && kinds.includes(item.kind), `${path}.kind`);
    requireField(typeof item.minutes === 'number' && Number.isFinite(item.minutes) && item.minutes > 0, `${path}.minutes`);
    requireField(strings(item.collections) && item.collections.every((scope) => scopes.includes(scope)), `${path}.collections`);
    for (const key of ['author', 'dynasty', 'dynastyNote', 'workId', 'note', 'curriculumId', 'referenceUrl', 'textSourceUrl'])
      requireField(item[key] === undefined || typeof item[key] === 'string', `${path}.${key}`);
    for (const key of ['aliases', 'bookIds', 'coveredContentIds']) requireField(item[key] === undefined || strings(item[key]), `${path}.${key}`);
    requireField(item.subject === undefined || (typeof item.subject === 'string' && ['poetry', 'english', 'reading', 'math', 'other'].includes(item.subject)), `${path}.subject`);
    requireField(item.builtin === undefined || item.builtin === false, `${path}.builtin`);
    requireField(item.studyArea === undefined || ['literacy', 'pinyin', 'reading'].includes(item.studyArea as string), `${path}.studyArea`);
    requireField(item.studyGrade == null || (typeof item.studyGrade === 'number' && Number.isInteger(item.studyGrade) && item.studyGrade >= 1 && item.studyGrade <= 9), `${path}.studyGrade`);
    if (item.gradeMappings !== undefined) {
      requireField(Array.isArray(item.gradeMappings), `${path}.gradeMappings`);
      item.gradeMappings.forEach((mapping: unknown) => {
        requireField(object(mapping), `${path}.gradeMappings entry`);
        requireField(typeof mapping.grade === 'number' && Number.isInteger(mapping.grade) && mapping.grade >= 1 && mapping.grade <= 9, `${path}.grade`);
        requireField(mapping.schoolSystem === '5-4' && mapping.status === 'catalogue_verified', `${path}.verification`);
        requireField(mapping.editionStatus === undefined || ['historical_reference', 'official_resource_verified'].includes(mapping.editionStatus as string), `${path}.editionStatus`);
        for (const key of ['bookId', 'semester', 'edition', 'sourceUrl', 'outlineDestination', 'sourceKind', 'evidence'])
          requireField(typeof mapping[key] === 'string' && mapping[key].length > 0, `${path}.${key}`);
        for (const key of ['sourcePdfPage', 'sourcePrintPage'])
          requireField(mapping[key] === undefined || (typeof mapping[key] === 'number' && Number.isInteger(mapping[key]) && mapping[key] > 0), `${path}.${key}`);
        requireField(mapping.unit === undefined || typeof mapping.unit === 'string', `${path}.unit`);
        requireField(['上册', '下册'].includes(mapping.semester as string), `${path}.semester`);
        requireField(mapping.unitId === undefined || (typeof mapping.unitId === 'string' && /^u\d+$/.test(mapping.unitId)), `${path}.unitId`);
        requireField(mapping.mappingType === undefined || ['textbook_item', 'aligned_practice'].includes(mapping.mappingType as string), `${path}.mappingType`);
      });
    }
  });
  const items = value as KnowledgeItem[];
  for (const item of items) for (const id of item.coveredContentIds || []) {
    const child = items.find(entry => entry.id === id);
    requireField(child && child.id !== item.id && child.kind === item.kind && !child.coveredContentIds?.length,
      `${item.id}.coveredContentIds must reference distinct leaf items of the same kind`);
  }
}
