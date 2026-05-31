import { describe, it, expect } from 'vitest';
import dict from '../src/dialect_food_dictionary.json';

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
