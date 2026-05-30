import { describe, it, expect } from 'vitest';
import { normalizeArabic } from '../src/query_understanding.js';

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
});
