import * as learning from './learning/learning';
import { pinyinEntries } from './pinyin-data';
import type { ContentInput, SchoolGrade } from '../../shared/models';

export interface PinyinToken { text: string; pinyin: string; before?: string; after?: string }
export interface PinyinText { title: PinyinToken[][]; body: PinyinToken[][] }
const han = /[\u3400-\u9fff]/;

function annotate(text: string, reading: string): PinyinToken[][] | null {
  const syllables = reading.split(/\s+/); let index = 0;
  const lines = text.split('\n').map((line) => {
    const tokens: PinyinToken[] = [];
    for (const character of line) {
      const pinyin = han.test(character) ? syllables[index++] : '';
      if (character === '儿' && pinyin === 'r' && tokens.length && tokens[tokens.length - 1].pinyin) {
        tokens[tokens.length - 1].text += character;
        tokens[tokens.length - 1].pinyin += 'r';
      } else tokens.push({ text: character, pinyin });
    }
    // Keep punctuation with its neighbouring character when a narrow screen wraps.
    const grouped: PinyinToken[] = []; let before = '';
    for (const token of tokens) {
      if (/^[（【《「『“‘]$/.test(token.text)) { before += token.text; continue; }
      if (/^[，。！？；：、）】》」』”’]$/.test(token.text) && grouped.length && !before) {
        const previous = grouped[grouped.length - 1];
        previous.after = (previous.after || '') + token.text;
      } else {
        grouped.push(before ? { ...token, before } : token); before = '';
      }
    }
    if (before) grouped.push({ text: before, pinyin: '' });
    return grouped;
  });
  return index === syllables.length && lines.every((line) => line.every((token) => token.pinyin !== undefined)) ? lines : null;
}

function pinyinFor(item: ContentInput): PinyinText | null {
  if (!['poetry', 'reading'].includes(learning.kindOf(item))) return null;
  const id = learning.contentId(item);
  const entry = pinyinEntries[id];
  // A same-title custom task or an old snapshot with different text must never inherit these sounds.
  if (!entry || item.title !== entry.title || item.detail !== entry.detail) return null;
  const title = annotate(entry.title, entry.titleReading);
  const body = annotate(entry.detail, entry.detailReading);
  if (!title || !body) return null;
  const author = learning.catalogById.get(id)?.author;
  if (author && entry.detail.startsWith(`${author}\n`)) body.shift();
  return { title, body };
}

const defaultPinyin = (grade?: SchoolGrade | null): boolean => grade === 1 || grade === 2;
export { pinyinFor, defaultPinyin };
