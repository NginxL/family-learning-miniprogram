import * as learning from './learning/learning';
import type { ContentKind, Task } from '../../shared/models';
const labels = { poetry: '读古诗文', word: '背单词', sentence: '读英语句子',
  'english-reading': '阅读英文文章', reading: '阅读与读书', math: '练数学', other: '其他学习' };
const modes = [{ id: 'new', label: '全新' }, { id: 'review', label: '复习' }, { id: 'manual', label: '家长安排' }];

function groupTasks<T extends Task>(tasks: T[]) {
  const buckets = new Map<ContentKind, T[]>();
  tasks.forEach((task) => {
    const kind = learning.definition(learning.kindOf(task));
    if (!buckets.has(kind.id)) buckets.set(kind.id, []);
    buckets.get(kind.id)!.push(task);
  });
  return learning.kinds.filter((kind) => buckets.has(kind.id)).map((kind) => {
    const items = buckets.get(kind.id)!;
    const doneCount = items.filter((task) => task.done).length;
    return { id: kind.id, subject: kind.subject, label: labels[kind.id] || kind.label, items,
      count: items.length, quantityLabel: `${items.length} ${kind.id === 'poetry' ? '篇 / 组' : kind.unit}`,
      doneCount, done: doneCount === items.length, pendingCount: items.filter((task) => task.pending).length,
      minutes: items.reduce((sum, task) => sum + task.minutes, 0),
      preview: items.slice(0, 3).map((task) => task.title).join('、') + (items.length > 3 ? ' …' : ''),
      modeSummary: modes.map((mode) => {
        const count = items.filter((task) => (task.mode || 'manual') === mode.id).length;
        return count ? `${mode.label} ${count}` : '';
      }).filter(Boolean).join(' · ') };
  });
}
export { groupTasks };
