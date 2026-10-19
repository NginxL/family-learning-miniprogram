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
  const revision = knowledge?.textRevision;
  const vocabularyRevision = knowledge?.vocabularyRevision;
  const contentRevision = knowledge?.contentRevision;
  const hasOlderText = (!!revision || !!vocabularyRevision || !!contentRevision) && typeof item.detail === 'string' && item.detail !== knowledge?.detail;
  return { ...item,
    textRevision: revision,
    vocabularyRevision,
    contentRevision,
    commonSenseSources: knowledge?.commonSenseSources || [],
    dictionaryReference: knowledge?.dictionaryReference || '',
    textCorrectionNotice: hasOlderText ? (vocabularyRevision
      ? '词义和词形说明已校订。本任务保留安排时的内容，学习笔记使用新版；请在“来源详情与说明”中核对新版词卡，学习记录不变。'
      : contentRevision ? '讲解或练习已校订。本任务保留安排时的内容，请在“来源详情与说明”中核对新版；学习记录不变。'
      : '正文已校订。本任务保留安排时的正文，请在“来源详情与说明”中查看校订正文；学习记录不变。') : '',
    correctedDetail: hasOlderText && knowledge ? (knowledge.author && knowledge.detail.startsWith(`${knowledge.author}\n`)
      ? knowledge.detail.slice(knowledge.author.length + 1) : knowledge.detail) : '',
    sourceGradeLabel: knowledge ? learning.knowledgeGradeLabel(knowledge) : '',
    sourceMappings: (knowledge?.gradeMappings || []).map((mapping, index) => ({ ...mapping, displayKey: `${mapping.bookId}:${index}`,
      verificationLabel: mapping.sourceKind === 'public_sample' ? '第三方样本 · 官方原页及册次待核实'
        : mapping.sourceKind === 'official_audio' ? '官方配套音频 · 纸本原页待核实' : '官方教材来源' })),
    sourceReferenceUrl: knowledge?.referenceUrl || '', sourceTextUrl: knowledge?.textSourceUrl || '',
    recitationSummary: (knowledge?.recitationRequirements || []).map(entry => {
      const mapping = knowledge?.gradeMappings?.find(mapping => mapping.bookId === entry.bookId);
      const label = mapping ? `${learning.gradeLabels[mapping.grade]}${mapping.semester}${mapping.editionStatus === 'historical_reference' ? '（旧版参考）' : ''}：` : '';
      return `${mapping ? label + entry.requirement : entry.label}${entry.start ? `（${entry.start}—${entry.end}）` : ''}`;
    }).join('\n')
  };
}
