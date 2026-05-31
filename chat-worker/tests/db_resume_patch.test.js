import { describe, it, expect } from 'vitest';
import patch from '../src/knowledge_db_resume_patch.json';

// Valid verdicts per the Phase Finale 3-layer schema (post-Task 4 pivot).
const VALID_VERDICTS = ['PASS_SIMPLE', 'PASS_WITH_EXPLANATION', 'EXPERT_ONLY'];

// Banned jargon applies to .simple ONLY (Layer 1 = mother test).
// .explanation (Layer 2) is allowed to use technical terms with context.
// User-approved list (Task 5 brief).
const BANNED_JARGON_SIMPLE = [
  'هيكسوز',
  'هكسوز',
  'ميتوكوندريا',
  'ميتابوليزم',
  'بروتيوميكس',
  'جلايكوجين',
  'ليبوبروتين',
  'بروستاجلاندين',
  'إنزيمات',
  'ATP',
  'mRNA',
  'GLUT',
  'جلوكاجون',
  'كيتون',
  'استقلاب',
  'أيض',
  'بروتوكول علاجي',
  'مقاومة مستقبلات',
];

// Banned medical disclaimer patterns (apply to BOTH layers — never want these).
const FORBIDDEN_DISCLAIMERS = [
  'استشر الطبيب',
  'استشارة طبية',
  'مراجعة طبيب',
];

const SIMPLE_PREFIX  = 'بحسب كلام الدكتور ضياء';
const EXPLAIN_PREFIX = 'شرح مبسط';
const MAX_SIMPLE     = 350;  // ~2 generous sentences
const MAX_EXPLAIN    = 600;  // up to ~4 sentences allowed for Layer 2

describe('knowledge_db_resume_patch — 3-layer schema', () => {
  it('is a non-empty object after Étape 4', () => {
    expect(typeof patch).toBe('object');
    expect(patch).not.toBeNull();
    expect(Object.keys(patch).length).toBeGreaterThan(0);
  });

  it('every key is a valid block.id (starts with yt-)', () => {
    for (const bid of Object.keys(patch)) {
      expect(bid.startsWith('yt-'),
        `Block ID "${bid}" should start with yt-`).toBe(true);
    }
  });

  it('every entry is an object (post-Task 4 pivot, not legacy string)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(typeof entry, `${bid} must be an object`).toBe('object');
      expect(entry, `${bid} must not be null`).not.toBeNull();
      expect(Array.isArray(entry), `${bid} must not be an array`).toBe(false);
    }
  });

  it('every entry has verdict + simple (required fields)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(entry, `${bid} missing 'verdict'`).toHaveProperty('verdict');
      expect(entry, `${bid} missing 'simple'`).toHaveProperty('simple');
    }
  });

  it('verdict is one of the valid enum values', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(VALID_VERDICTS, `${bid} has invalid verdict "${entry.verdict}"`)
        .toContain(entry.verdict);
    }
  });

  it('PASS_WITH_EXPLANATION and EXPERT_ONLY entries have explanation field', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      if (entry.verdict === 'PASS_WITH_EXPLANATION' || entry.verdict === 'EXPERT_ONLY') {
        expect(entry, `${bid} (verdict=${entry.verdict}) must have explanation`)
          .toHaveProperty('explanation');
        expect(typeof entry.explanation,
          `${bid}.explanation must be a string`).toBe('string');
        expect(entry.explanation.length,
          `${bid}.explanation must be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('no DELETE entries present (deleted ones are removed from patch)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(entry.verdict).not.toBe('DELETE');
    }
  });
});

describe('knowledge_db_resume_patch — Layer 1 (simple) mother test soft-check', () => {
  it('every .simple is a non-empty string', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(typeof entry.simple, `${bid}.simple must be string`).toBe('string');
      expect(entry.simple.length, `${bid}.simple must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('every .simple starts with the canonical prefix', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(entry.simple.startsWith(SIMPLE_PREFIX) || entry.simple.startsWith(SIMPLE_PREFIX + '،'),
        `${bid}.simple must start with "${SIMPLE_PREFIX}"`).toBe(true);
    }
  });

  it('every .simple is ≤ 350 chars (mother test: 1-2 sentences)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      expect(entry.simple.length,
        `${bid}.simple too long (${entry.simple.length} chars): ${entry.simple.slice(0, 100)}...`)
        .toBeLessThanOrEqual(MAX_SIMPLE);
    }
  });

  it('no .simple contains banned jargon (mother test)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      for (const term of BANNED_JARGON_SIMPLE) {
        expect(entry.simple.includes(term),
          `${bid}.simple contains banned jargon "${term}": ${entry.simple.slice(0, 150)}`)
          .toBe(false);
      }
    }
  });

  it('no .simple contains forbidden medical disclaimer', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      for (const pat of FORBIDDEN_DISCLAIMERS) {
        expect(entry.simple.includes(pat),
          `${bid}.simple contains forbidden disclaimer "${pat}"`).toBe(false);
      }
    }
  });
});

describe('knowledge_db_resume_patch — Layer 2 (explanation) checks', () => {
  it('every .explanation starts with "شرح مبسط"', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      if (!entry.explanation) continue;
      expect(entry.explanation.startsWith(EXPLAIN_PREFIX),
        `${bid}.explanation must start with "${EXPLAIN_PREFIX}"`).toBe(true);
    }
  });

  it('every .explanation is ≤ 600 chars (up to 4 sentences)', () => {
    for (const [bid, entry] of Object.entries(patch)) {
      if (!entry.explanation) continue;
      expect(entry.explanation.length,
        `${bid}.explanation too long (${entry.explanation.length} chars)`)
        .toBeLessThanOrEqual(MAX_EXPLAIN);
    }
  });

  it('no .explanation contains forbidden medical disclaimer', () => {
    // Disclaimers banned EVERYWHERE, not just simple.
    for (const [bid, entry] of Object.entries(patch)) {
      if (!entry.explanation) continue;
      for (const pat of FORBIDDEN_DISCLAIMERS) {
        expect(entry.explanation.includes(pat),
          `${bid}.explanation contains forbidden disclaimer "${pat}"`).toBe(false);
      }
    }
  });
});

describe('knowledge_db_resume_patch — verdict distribution', () => {
  it('has at least one entry per non-DELETE verdict (sanity check seed)', () => {
    const verdicts = new Set(Object.values(patch).map(e => e.verdict));
    // Phase A seed should have a mix; we expect at minimum PASS_SIMPLE and PASS_WITH_EXPLANATION.
    expect(verdicts.has('PASS_SIMPLE')).toBe(true);
    expect(verdicts.has('PASS_WITH_EXPLANATION')).toBe(true);
    // EXPERT_ONLY may or may not be present; don't assert.
  });
});
