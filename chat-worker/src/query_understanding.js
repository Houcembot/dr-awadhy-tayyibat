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
