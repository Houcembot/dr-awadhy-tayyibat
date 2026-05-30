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
