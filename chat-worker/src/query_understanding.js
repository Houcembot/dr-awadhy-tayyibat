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
function emptyResult() {
  return {
    canonical_foods: [],
    strong_matches: [],
    related_concepts: [],
    expanded_terms: [],
    human_readable_ar: '',
    dialect_hint: null,
  };
}

export function detectConcepts(question, dictionary) {
  if (!question || !dictionary) return emptyResult();

  const normalized = normalizeArabic(question);
  if (!normalized) return emptyResult();

  const matched = matchDictionaryEntries(normalized, dictionary);
  if (matched.length === 0) return emptyResult();

  const canonical_foods = matched.map(m => m.canonical);

  const strong_matches = uniq(
    matched
      .filter(m => m.entry.confidence === 'high')
      .flatMap(m => m.entry.strong_matches || [])
  );

  const related_concepts = uniq(
    matched.flatMap(m => m.entry.related_concepts || [])
  );

  const expanded_terms = uniq([
    ...canonical_foods,
    ...strong_matches,
    ...related_concepts,
  ]);

  return {
    canonical_foods,
    strong_matches,
    related_concepts,
    expanded_terms,
    human_readable_ar: buildHumanReadable(matched),
    dialect_hint: matched.find(m => m.entry.dialect)?.entry.dialect || null,
  };
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

function uniq(arr) {
  return [...new Set(arr)];
}

// Strip Arabic definite article ال from the head of a string for display.
function stripDefArticle(s) {
  return s.startsWith('ال') ? s.slice(2) : s;
}

function buildHumanReadable(matched) {
  if (!matched.length) return '';
  const { canonical, entry } = matched[0];
  const isDish = entry.type === 'dish';
  // Phase A handles only type === 'dish' or 'food'. Future seed entries with
  // type === 'dessert' / 'boisson' would currently fall through to the food
  // label — explicit handling can be added in Étape 2 when those types appear.
  const label = isDish ? 'تم فهم الطبق:' : 'تم فهم السؤال:';
  const head = isDish ? stripDefArticle(canonical) : canonical;

  // Mirror detectConcepts's filter: only confidence:'high' entries contribute
  // strong_matches to the rendered "← ingrédients" line. Keeps human_readable_ar
  // and result.strong_matches consistent.
  const displayStrongMatches =
    entry.confidence === 'high' ? (entry.strong_matches || []) : [];

  let mainLine;
  if (isDish && displayStrongMatches.length > 0) {
    mainLine = `${head} ← ${displayStrongMatches.join(' + ')}`;
  } else {
    mainLine = `${head} (${entry.category})`;
  }

  const lines = [label, '', mainLine];
  if (entry.related_concepts && entry.related_concepts.length > 0) {
    lines.push(`↳ مرتبط بـ${entry.related_concepts.join('، ')}`);
  }
  return lines.join('\n');
}
