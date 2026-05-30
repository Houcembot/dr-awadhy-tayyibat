import { describe, it, expect } from 'vitest';
import {
  normalizeArabic,
  tokenize,
  anchorMatchesToken,
  textHasAnchor,
  detectConcepts,
} from '../src/query_understanding.js';

const TEST_DICT = {
  'البطاطس': {
    type: 'food',
    category: 'نشويات',
    synonyms: ['بطاطس', 'بطاطا', 'بطاط'],
    ingredients: [],
    strong_matches: [],
    related_concepts: ['نشويات', 'سكريات'],
    confidence: 'high',
    dialect: null,
  },
  'الكسكسي': {
    type: 'dish',
    category: 'نشويات',
    synonyms: ['كسكسي', 'كسكس'],
    ingredients: ['سميد', 'قمح'],
    strong_matches: ['سميد', 'قمح'],
    related_concepts: ['نشويات'],
    confidence: 'high',
    dialect: 'maghrebi',
  },
  'العسل': {
    type: 'food',
    category: 'سكريات',
    synonyms: ['عسل'],
    ingredients: [],
    strong_matches: [],
    related_concepts: ['سكر'],
    confidence: 'high',
    dialect: null,
  },
  'البريك': {
    type: 'dish',
    category: 'نشويات',
    synonyms: ['بريك', 'بوريك'],
    ingredients: ['دقيق', 'زيت', 'بيض'],
    strong_matches: [],
    related_concepts: ['نشويات'],
    confidence: 'low',
    dialect: 'maghrebi',
  },
  'الخبز': {
    type: 'food',
    category: 'نشويات',
    synonyms: ['خبز', 'عيش'],
    ingredients: [],
    strong_matches: [],
    related_concepts: ['نشويات'],
    confidence: 'high',
    dialect: null,
  },
};

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

describe('anchorMatchesToken', () => {
  it('matches the bare anchor', () => {
    expect(anchorMatchesToken('بطاطس', 'بطاطس')).toBe(true);
  });

  it('matches with ال prefix', () => {
    expect(anchorMatchesToken('البطاطس', 'بطاطس')).toBe(true);
  });

  it('matches with و prefix', () => {
    expect(anchorMatchesToken('ورز', 'رز')).toBe(true);
  });

  it('matches with combined بال prefix', () => {
    expect(anchorMatchesToken('بالبطاطس', 'بطاطس')).toBe(true);
  });

  it('matches with ه pronoun suffix', () => {
    expect(anchorMatchesToken('بطاطسه', 'بطاطس')).toBe(true);
  });

  it('matches with ات plural suffix', () => {
    expect(anchorMatchesToken('بطاطسات', 'بطاطس')).toBe(true);
  });

  it('rejects substring inside an unrelated stem (رز in رزقنا)', () => {
    expect(anchorMatchesToken('رزقنا', 'رز')).toBe(false);
  });

  it('rejects substring inside an unrelated stem (رز in ورزقنا)', () => {
    expect(anchorMatchesToken('ورزقنا', 'رز')).toBe(false);
  });

  it('rejects when token is too short to contain anchor', () => {
    expect(anchorMatchesToken('ال', 'بطاطس')).toBe(false);
  });
});

describe('textHasAnchor', () => {
  it('returns true when any token matches', () => {
    expect(textHasAnchor('هل البطاطس صحية', 'بطاطس')).toBe(true);
  });

  it('returns false when no token matches', () => {
    expect(textHasAnchor('هل العسل صحي', 'بطاطس')).toBe(false);
  });

  it('does not false-positive on ورزقنا for anchor رز', () => {
    expect(textHasAnchor('ورزقنا على الله', 'رز')).toBe(false);
  });

  it('handles already-normalized text', () => {
    expect(textHasAnchor('هل الرز مناسب', 'رز')).toBe(true);
  });
});

describe('detectConcepts — skeleton', () => {
  it('returns all-empty shape for a question matching nothing', () => {
    const result = detectConcepts('xyz aliénation', TEST_DICT);
    expect(result).toEqual({
      canonical_foods: [],
      strong_matches: [],
      related_concepts: [],
      expanded_terms: [],
      human_readable_ar: '',
      dialect_hint: null,
    });
  });

  it('returns all-empty shape when dictionary is empty', () => {
    const result = detectConcepts('هل البطاطس صحية؟', {});
    expect(result.canonical_foods).toEqual([]);
    expect(result.strong_matches).toEqual([]);
    expect(result.related_concepts).toEqual([]);
    expect(result.human_readable_ar).toBe('');
    expect(result.dialect_hint).toBe(null);
  });

  it('returns all-empty shape for empty question', () => {
    const result = detectConcepts('', TEST_DICT);
    expect(result).toEqual({
      canonical_foods: [],
      strong_matches: [],
      related_concepts: [],
      expanded_terms: [],
      human_readable_ar: '',
      dialect_hint: null,
    });
  });

  it('does not share array references across calls', () => {
    const r1 = detectConcepts('', TEST_DICT);
    const r2 = detectConcepts('', TEST_DICT);
    // Mutating r1 must not affect r2
    r1.canonical_foods.push('contaminant');
    expect(r2.canonical_foods).toEqual([]);
    // Each call returns a fresh top-level object too
    expect(r1).not.toBe(r2);
  });

  it('finds the canonical food when a synonym is in the question', () => {
    const result = detectConcepts('هل البطاطس ترفع السكر؟', TEST_DICT);
    expect(result.canonical_foods).toEqual(['البطاطس']);
  });

  it('finds the canonical via a synonym (بطاطا)', () => {
    const result = detectConcepts('هل البطاطا مفيدة؟', TEST_DICT);
    expect(result.canonical_foods).toEqual(['البطاطس']);
  });

  it('finds multiple canonicals in the same question', () => {
    const result = detectConcepts('هل العسل والكسكسي صحيان؟', TEST_DICT);
    expect(result.canonical_foods.sort()).toEqual(['العسل', 'الكسكسي'].sort());
  });

  it('populates expanded_terms with canonical + strong + related (deduped)', () => {
    const result = detectConcepts('هل الكسكسي ينفع؟', TEST_DICT);
    expect(new Set(result.expanded_terms)).toEqual(
      new Set(['الكسكسي', 'سميد', 'قمح', 'نشويات'])
    );
  });

  it('does not pull strong_matches from confidence:low entries', () => {
    // البريك has confidence: 'low' in TEST_DICT
    const result = detectConcepts('هل البريك صحي؟', TEST_DICT);
    expect(result.canonical_foods).toEqual(['البريك']);
    expect(result.strong_matches).toEqual([]);  // empty because confidence is low
    expect(result.related_concepts).toContain('نشويات');
  });

  it('mixes a high and a low entry correctly', () => {
    // الكسكسي (high) + البريك (low) both matched
    const result = detectConcepts('هل الكسكسي والبريك صحيان؟', TEST_DICT);
    expect(result.canonical_foods.sort()).toEqual(['البريك', 'الكسكسي'].sort());
    // strong_matches only from الكسكسي (high)
    expect(new Set(result.strong_matches)).toEqual(new Set(['سميد', 'قمح']));
  });

  it('builds pedagogic human_readable_ar for a dish with strong matches', () => {
    const result = detectConcepts('هل الكسكسي ينفع؟', TEST_DICT);
    expect(result.human_readable_ar).toBe(
      'تم فهم الطبق:\n\nكسكسي ← سميد + قمح\n↳ مرتبط بـنشويات'
    );
  });

  it('builds human_readable_ar for a base food (no strong matches)', () => {
    const result = detectConcepts('هل الخبز صحي؟', TEST_DICT);
    expect(result.human_readable_ar).toBe(
      'تم فهم السؤال:\n\nالخبز (نشويات)\n↳ مرتبط بـنشويات'
    );
  });

  it('builds human_readable_ar for a dish without strong matches (confidence low)', () => {
    // البريك: type=dish, confidence=low → strong_matches empty in output
    const result = detectConcepts('هل البريك صحي؟', TEST_DICT);
    expect(result.human_readable_ar).toBe(
      'تم فهم الطبق:\n\nبريك (نشويات)\n↳ مرتبط بـنشويات'
    );
  });

  it('omits the related line when related_concepts is empty', () => {
    // synthetic dict entry with no related_concepts
    const dict = {
      'الماء': {
        type: 'food',
        category: 'مشروبات',
        synonyms: ['ماء', 'ميه'],
        ingredients: [],
        strong_matches: [],
        related_concepts: [],
        confidence: 'high',
        dialect: null,
      },
    };
    const result = detectConcepts('هل الماء يكفي؟', dict);
    expect(result.human_readable_ar).toBe('تم فهم السؤال:\n\nالماء (مشروبات)');
  });

  it('renders only the first canonical when several are detected', () => {
    // Multi-canonical: human_readable shows the first only; both are in canonical_foods.
    const result = detectConcepts('هل العسل والكسكسي صحيان؟', TEST_DICT);
    expect(result.canonical_foods.length).toBe(2);
    // Human readable starts with one canonical
    expect(result.human_readable_ar.startsWith('تم فهم')).toBe(true);
    // Two lines after the header (mainLine + related), single canonical rendered
    const linesAfterHeader = result.human_readable_ar.split('\n\n')[1] || '';
    const firstLine = linesAfterHeader.split('\n')[0];
    // Both canonicals shouldn't appear on the same line
    expect(firstLine.includes('العسل') && firstLine.includes('كسكسي')).toBe(false);
  });
});
