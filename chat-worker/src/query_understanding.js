/**
 * query_understanding.js — Phase Finale Étape 1.
 * Pure module: normalize, tokenize, anchor matching, concept detection.
 * No IO, no JSON imports. Dictionary is passed in as a parameter.
 */

const _TASHKEEL = /[ً-ٰٟ]/g;
const _PUNCT    = /[؟?!.،,؛:"]/g;

export function normalizeArabic(text) {
  return String(text || '')
    .replace(_TASHKEEL, '')
    .replace(_PUNCT, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

export function tokenize(text) {
  const n = normalizeArabic(text);
  if (!n) return new Set();
  return new Set(n.split(/\s+/).filter(Boolean));
}

// ── Word-boundary anchor matching ─────────────────────────────────────────────
// Match anchors as TOKENS with optional Arabic prefix/suffix stripping.
// NOT as substrings — prevents false positives like ورزقنا matching رز.
const _AR_PREFIXES = ['', 'ال','و','ف','ب','ل','ك','س',
                      'وال','فال','بال','كال','ولا','وب','ول','فل','بل','لل'];
const _AR_SUFFIXES = ['', 'ه','ها','هم','هن','ي','ك','كم','كن','نا',
                      'ات','ون','ين','يه','تي','هما'];

// Contract: both `token` and `anchor` MUST already be normalized via
// normalizeArabic. Callers handling raw user/text input should use
// textHasAnchor (which normalizes internally) instead.
export function anchorMatchesToken(token, anchor) {
  if (!token || !anchor) return false;
  for (const p of _AR_PREFIXES) {
    if (!token.startsWith(p)) continue;
    const rest = token.slice(p.length);
    for (const sfx of _AR_SUFFIXES) {
      if (rest === anchor + sfx) return true;
    }
  }
  return false;
}

export function textHasAnchor(text, anchor) {
  if (!text || !anchor) return false;
  const tokens = tokenize(text);
  const normAnchor = normalizeArabic(anchor);
  for (const tok of tokens) {
    if (anchorMatchesToken(tok, normAnchor)) return true;
  }
  return false;
}

// ── Concept detection ─────────────────────────────────────────────────────────
const EMPTY_RESULT = {
  canonical_foods: [],
  strong_matches: [],
  related_concepts: [],
  expanded_terms: [],
  human_readable_ar: '',
  dialect_hint: null,
};

export function detectConcepts(question, dictionary) {
  if (!question || !dictionary) return { ...EMPTY_RESULT };

  const normalized = normalizeArabic(question);
  if (!normalized) return { ...EMPTY_RESULT };

  const matched = matchDictionaryEntries(normalized, dictionary);
  if (matched.length === 0) return { ...EMPTY_RESULT };

  // Placeholder — fully implemented in Tasks 5-7
  return { ...EMPTY_RESULT };
}

function matchDictionaryEntries(normalizedQuestion, dictionary) {
  const matched = [];
  for (const [canonical, entry] of Object.entries(dictionary)) {
    const terms = [canonical, ...(entry.synonyms || [])].map(normalizeArabic);
    const hit = terms.some(t => textHasAnchor(normalizedQuestion, t));
    if (hit) matched.push({ canonical, entry });
  }
  return matched;
}
