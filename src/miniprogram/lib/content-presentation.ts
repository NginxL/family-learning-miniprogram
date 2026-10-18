import * as learning from './learning/learning';
import type { ContentInput, KnowledgeItem } from '../../shared/models';

// Concise learning labels; the original verification wording remains in the source disclosure.
export function learningGradeLabel(item: KnowledgeItem): string {
  if (item.gradeMappings?.length) return [...new Set(item.gradeMappings.map(mapping =>
    `${learning.gradeLabels[mapping.grade]}${mapping.semester}${mapping.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}`))].join('、')
    + (item.gradeMappings.every(mapping => mapping.mappingType === 'aligned_practice') ? ' · 原创配套练习' : '');
  if (item.learningArea) return '课标基础知识';
  if (item.kind === 'word') return item.collections.includes('tables') ? '国家课标另列表' : item.collections.includes('moe-all') ? '国家课标词表' : '英语词汇';
  return ['reading', 'english-reading'].includes(item.kind) ? '自编入门练习' : '';
}
export function withContentSources<T extends ContentInput>(item: T) {
  const knowledge = learning.catalogById.get(learning.contentId(item));
  return { ...item,
    sourceGradeLabel: knowledge ? learning.knowledgeGradeLabel(knowledge) : '',
    sourceMappings: (knowledge?.gradeMappings || []).map((mapping, index) => ({ ...mapping, displayKey: `${mapping.bookId}:${index}` })),
    sourceReferenceUrl: knowledge?.referenceUrl || '', sourceTextUrl: knowledge?.textSourceUrl || '',
    recitationSummary: (knowledge?.recitationRequirements || []).map(entry => {
      const mapping = knowledge?.gradeMappings?.find(mapping => mapping.bookId === entry.bookId);
      const label = mapping ? `${learning.gradeLabels[mapping.grade]}${mapping.semester}${mapping.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}：` : '';
      return `${label}${entry.label}${entry.start ? `（${entry.start}—${entry.end}）` : ''}`;
    }).join('\n')
  };
}
