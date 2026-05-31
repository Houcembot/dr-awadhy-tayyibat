import { describe, it, expect } from 'vitest';
import dict from '../src/dialect_food_dictionary.json';
import { detectConcepts } from '../src/query_understanding.js';

const VALID_TYPES = ['dish', 'food'];
const VALID_CONFIDENCE = ['high', 'low'];
const VALID_DIALECTS = ['maghrebi', 'egyptian', 'levant', 'khaliji', null];

describe('dialect_food_dictionary schema', () => {
  it('is a non-empty object', () => {
    expect(typeof dict).toBe('object');
    expect(dict).not.toBeNull();
    expect(Object.keys(dict).length).toBeGreaterThan(0);
  });

  it('every canonical key is a non-empty Arabic string', () => {
    for (const canonical of Object.keys(dict)) {
      expect(canonical.length).toBeGreaterThan(0);
      // Canonical should start with ال (definite article) — convention for Phase A seed
      expect(canonical.startsWith('ال')).toBe(true);
    }
  });

  it('every entry has all 8 required fields', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      const required = ['type', 'category', 'synonyms', 'ingredients',
                        'strong_matches', 'related_concepts', 'confidence', 'dialect'];
      for (const field of required) {
        expect(entry, `entry "${canonical}" missing field "${field}"`).toHaveProperty(field);
      }
    }
  });

  it('every entry has valid type and confidence values', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      expect(VALID_TYPES, `entry "${canonical}" has bad type`).toContain(entry.type);
      expect(VALID_CONFIDENCE, `entry "${canonical}" has bad confidence`).toContain(entry.confidence);
      expect(VALID_DIALECTS, `entry "${canonical}" has bad dialect`).toContain(entry.dialect);
    }
  });

  it('every entry has array fields as actual arrays', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      for (const field of ['synonyms', 'ingredients', 'strong_matches', 'related_concepts']) {
        expect(Array.isArray(entry[field]),
               `entry "${canonical}".${field} should be array`).toBe(true);
        for (const v of entry[field]) {
          expect(typeof v, `entry "${canonical}".${field} should be string[]`).toBe('string');
          expect(v.length, `entry "${canonical}".${field} should not have empty strings`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('synonyms array is non-empty for every entry', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      expect(entry.synonyms.length,
             `entry "${canonical}" must have at least one synonym`).toBeGreaterThan(0);
    }
  });

  it('confidence:low entries have empty strong_matches', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      if (entry.confidence === 'low') {
        expect(entry.strong_matches,
               `entry "${canonical}" has confidence:low but strong_matches is non-empty`).toEqual([]);
      }
    }
  });

  it('category is a non-empty string', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  it('strong_matches is a subset of ingredients (or empty)', () => {
    for (const [canonical, entry] of Object.entries(dict)) {
      for (const sm of entry.strong_matches) {
        expect(entry.ingredients.includes(sm),
               `entry "${canonical}".strong_matches has "${sm}" which is not in ingredients`).toBe(true);
      }
    }
  });
});

describe('dialect_food_dictionary integration with detectConcepts', () => {
  it('detects الخبز canonical for "هل الخبز صحي؟"', () => {
    const r = detectConcepts('هل الخبز صحي؟', dict);
    expect(r.canonical_foods).toContain('الخبز');
  });

  it('detects العسل canonical for "هل العسل صحي؟"', () => {
    const r = detectConcepts('هل العسل صحي؟', dict);
    expect(r.canonical_foods).toContain('العسل');
  });

  it('detects البطاطس canonical for "هل البطاطس ترفع السكر؟"', () => {
    const r = detectConcepts('هل البطاطس ترفع السكر؟', dict);
    expect(r.canonical_foods).toContain('البطاطس');
  });

  it('detects التمر canonical for "هل التمر يرفع السكر؟"', () => {
    const r = detectConcepts('هل التمر يرفع السكر؟', dict);
    expect(r.canonical_foods).toContain('التمر');
  });

  it('detects الرز canonical for "هل الرز مناسب لمريض السكر؟"', () => {
    const r = detectConcepts('هل الرز مناسب لمريض السكر؟', dict);
    expect(r.canonical_foods).toContain('الرز');
  });

  it('detects الكسكسي + ingredients for "هل الكسكسي ينفع؟"', () => {
    const r = detectConcepts('هل الكسكسي ينفع؟', dict);
    expect(r.canonical_foods).toContain('الكسكسي');
    expect(r.strong_matches).toEqual(expect.arrayContaining(['سميد', 'قمح']));
    expect(r.dialect_hint).toBe('maghrebi');
  });

  it('detects المقروض + ingredients for "هل المقروض يرفع السكر؟"', () => {
    const r = detectConcepts('هل المقروض يرفع السكر؟', dict);
    expect(r.canonical_foods).toContain('المقروض');
    expect(r.strong_matches).toEqual(expect.arrayContaining(['سميد', 'تمر', 'سكر']));
    expect(r.dialect_hint).toBe('maghrebi');
  });

  it('detects الكشري + ingredients for "هل الكشري صحي؟"', () => {
    const r = detectConcepts('هل الكشري صحي؟', dict);
    expect(r.canonical_foods).toContain('الكشري');
    expect(r.strong_matches).toEqual(expect.arrayContaining(['رز', 'عدس', 'مكرونة']));
    expect(r.dialect_hint).toBe('egyptian');
  });

  it('detects البريك as confidence:low (empty strong_matches) for "هل البريك صحي؟"', () => {
    const r = detectConcepts('هل البريك صحي؟', dict);
    expect(r.canonical_foods).toContain('البريك');
    // confidence:low → no strong_matches contribution from this entry
    expect(r.strong_matches).toEqual([]);
    // But related_concepts still populated
    expect(r.related_concepts).toContain('نشويات');
  });

  it('detects الزلابية + ingredients for "هل الزلابية ترفع السكر؟"', () => {
    const r = detectConcepts('هل الزلابية ترفع السكر؟', dict);
    expect(r.canonical_foods).toContain('الزلابية');
    expect(r.strong_matches).toEqual(expect.arrayContaining(['دقيق', 'سكر']));
  });

  it('builds pedagogic human_readable_ar for كسكسي', () => {
    const r = detectConcepts('هل الكسكسي ينفع؟', dict);
    expect(r.human_readable_ar).toContain('تم فهم الطبق');
    expect(r.human_readable_ar).toContain('كسكسي');
    expect(r.human_readable_ar).toContain('سميد');
    expect(r.human_readable_ar).toContain('قمح');
  });

  it('returns empty result for unrelated question', () => {
    const r = detectConcepts('ما هو الوقت الآن؟', dict);
    expect(r.canonical_foods).toEqual([]);
    expect(r.expanded_terms).toEqual([]);
    expect(r.human_readable_ar).toBe('');
  });
});
