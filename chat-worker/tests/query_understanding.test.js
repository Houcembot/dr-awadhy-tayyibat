import { describe, it, expect } from 'vitest';
import { normalizeArabic, tokenize } from '../src/query_understanding.js';

describe('normalizeArabic', () => {
  it('strips tashkeel diacritics', () => {
    expect(normalizeArabic('السُّكَّر')).toBe('السكر');
  });

  it('replaces ؟ ! . ، ؛ : with spaces', () => {
    expect(normalizeArabic('هل البطاطس ترفع السكر؟')).toBe('هل البطاطس ترفع السكر');
    expect(normalizeArabic('العسل، التمر!')).toBe('العسل التمر');
  });

  it('normalizes alef variants أ إ آ to ا', () => {
    expect(normalizeArabic('أكل')).toBe('اكل');
    expect(normalizeArabic('إنسولين')).toBe('انسولين');
    expect(normalizeArabic('آدم')).toBe('ادم');
  });

  it('normalizes ة to ه and ى to ي', () => {
    expect(normalizeArabic('حبة')).toBe('حبه');
    expect(normalizeArabic('ليلى')).toBe('ليلي');
  });

  it('collapses multiple spaces and trims', () => {
    expect(normalizeArabic('  هل   البطاطس   ')).toBe('هل البطاطس');
  });

  it('lowercases ASCII characters', () => {
    expect(normalizeArabic('HbA1c')).toBe('hba1c');
  });

  it('handles empty input safely', () => {
    expect(normalizeArabic('')).toBe('');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic(undefined)).toBe('');
  });

  it('preserves Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩', () => {
    expect(normalizeArabic('١ ملعقة سكر')).toBe('١ ملعقه سكر');
    expect(normalizeArabic('هيموغلوبين أ١ج')).toBe('هيموغلوبين ا١ج');
    expect(normalizeArabic('٢٠٢٦')).toBe('٢٠٢٦');
  });
});

describe('tokenize', () => {
  it('splits a normalized phrase into a Set of tokens', () => {
    const result = tokenize('هل البطاطس ترفع السكر');
    expect(result).toBeInstanceOf(Set);
    expect([...result].sort()).toEqual(['البطاطس', 'السكر', 'ترفع', 'هل'].sort());
  });

  it('normalizes before tokenizing (strips ؟ from token)', () => {
    const result = tokenize('هل البطاطس؟');
    expect(result.has('البطاطس')).toBe(true);
    expect(result.has('البطاطس؟')).toBe(false);
  });

  it('returns an empty Set for whitespace-only input', () => {
    expect([...tokenize('  ')]).toEqual([]);
  });
});
