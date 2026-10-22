export interface Pronunciation { headword: string; accent: 'UK' | 'US' | 'IPA'; ipa: string; usage?: string }
export interface WordSupplement {
  pronunciations: Pronunciation[];
  senses: Array<{ pos: string; meaning: string }>;
  sources: Array<{ title: string; url: string }>;
  forms: Array<{ label: string; value: string; pos: string; meaning: string }>;
}
declare const data: Record<string, WordSupplement>;
export default data;
