/**
 * retrieval_v2.js — Phase 2 retrieval, 0 API calls.
 * Pure keyword scoring on knowledge_raw.json.
 * Endpoint: POST /api/chat_v2
 */
import knowledgeRaw from './knowledge_index.json';
import dictionary from './dialect_food_dictionary.json';
import dbResumePatch from './knowledge_db_resume_patch.json';
import foodInvertedIndex from './food_inverted_index.json';
import {
  normalizeArabic,
  anchorMatchesToken,
  textHasAnchor,
  detectConcepts,
} from './query_understanding.js';

// ── Scoring ───────────────────────────────────────────────────────────────────
const DOMAIN_SCORE = { nutrition: 3, medical: 1, off_topic: -20, general: 0 };

// ── Module-level pre-computation (one-time, at worker startup) ──────────────
// BUILD HEAVY / RUNTIME LIGHT: everything below is computed once when the
// module loads, never per request.

// Block lookup by id (avoids array scans)
const BLOCK_MAP = new Map();
for (const b of knowledgeRaw) {
  if (b.domain !== 'off_topic') BLOCK_MAP.set(b.id, b);
}

// Inverted index converted to Sets for O(1) "block contains anchor" checks
const ANCHOR_BLOCK_SETS = {};
for (const [anchor, ids] of Object.entries(foodInvertedIndex)) {
  ANCHOR_BLOCK_SETS[anchor] = new Set(ids);
}

// Pre-computed raw_quote dedup keys (avoids normalizeArabic on full raw_quote at
// retrieval time — each block's key is computed once at module load).
const BLOCK_RAW_QUOTE_KEY = new Map();
// Pre-normalized full raw_quote per block, for runtime occurrence-count density bonus.
const BLOCK_NORM_RAW = new Map();
for (const [id, block] of BLOCK_MAP) {
  const norm = normalizeArabic(block.raw_quote);
  BLOCK_RAW_QUOTE_KEY.set(id, norm.slice(0, 100));
  BLOCK_NORM_RAW.set(id, norm);
}
// Pre-normalized db_resume.simple text — used at scoring time to verify a
// curated block is actually ABOUT the queried canonical before granting the
// +25 doctrine boost. Prevents bread-doctrine blocks from stealing sugar
// queries just because they have a db_resume.
const DB_RESUME_NORM = new Map();
// Set of block ids whose doctrine_position is a clear verdict (good/bad/
// natural/bad_industrial/good_natural/good_for_dr_dia_system). Blocks with a
// clear stance outrank "neutral" expert blocks on doctrine queries.
const VERDICT_BLOCKS = new Set();
const NEUTRAL_POSITIONS = new Set(['neutral', null, undefined, '']);
for (const [id, entry] of Object.entries(dbResumePatch)) {
  if (entry && entry.simple) DB_RESUME_NORM.set(id, normalizeArabic(entry.simple));
  if (entry && !NEUTRAL_POSITIONS.has(entry.doctrine_position)) VERDICT_BLOCKS.add(id);
}

// Per-question detectConcepts cache (bounded at 256 entries — safe for Workers).
// Eliminates repeated dictionary scan when the same question hits the endpoint
// multiple times (retries, parallel requests, benchmark warm-up).
const _conceptsCache = new Map();
function detectConceptsCached(question) {
  let result = _conceptsCache.get(question);
  if (!result) {
    result = detectConcepts(question, dictionary);
    if (_conceptsCache.size >= 256) {
      // Evict the oldest entry to stay bounded.
      _conceptsCache.delete(_conceptsCache.keys().next().value);
    }
    _conceptsCache.set(question, result);
  }
  return result;
}

// ── Snippet centering ─────────────────────────────────────────────────────────
// When the question targets a specific food/concept, show the part of the
// raw_quote AROUND that anchor instead of the first 400 chars (which is often
// an off-topic intro).
export function findAnchorPosInRaw(rawQuote, anchors) {
  // Walk the raw_quote tokens; return the raw_quote index of the first
  // token (after normalization) that matches any anchor.
  const re = /\S+/g;
  let m;
  while ((m = re.exec(rawQuote)) !== null) {
    const tok = normalizeArabic(m[0]);
    for (const a of anchors) {
      if (anchorMatchesToken(tok, a)) return m.index;
    }
  }
  return -1;
}

export function buildSnippet(rawQuote, anchors, maxLen = 400) {
  if (rawQuote.length <= maxLen) return rawQuote;
  if (!anchors || anchors.length === 0) {
    return rawQuote.slice(0, maxLen) + '…';
  }
  const bestPos = findAnchorPosInRaw(rawQuote, anchors);
  if (bestPos < 0) return rawQuote.slice(0, maxLen) + '…';

  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, bestPos - half);
  let end   = Math.min(rawQuote.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);

  // Snap to word boundaries to avoid mid-word cuts.
  if (start > 0) {
    const sp = rawQuote.lastIndexOf(' ', start);
    if (sp >= start - 40 && sp > 0) start = sp + 1;
  }
  if (end < rawQuote.length) {
    const sp = rawQuote.indexOf(' ', end);
    if (sp >= 0 && sp <= end + 40) end = sp;
  }

  let out = rawQuote.slice(start, end);
  if (start > 0) out = '…' + out;
  if (end < rawQuote.length) out = out + '…';
  return out;
}

// ── Scoring V3 ──────────────────────────────────────────────────────────────
// Concept-aware: each matched concept category contributes a different bonus.
// Returns { score, hits: { canonical, strong, related, generic } } so the
// acceptance rule (Task 4) can inspect WHICH category was hit.
const GENERIC_SYNONYMS = ['سكر','سكري','جلوكوز','هيموجلوبين','hba1c','سكريات'];

// Pre-normalize GENERIC_SYNONYMS once at module load (optimization: avoids
// calling normalizeArabic on each per-request invocation of retrieveBlocks).
const GENERIC_SYNONYMS_NORM = GENERIC_SYNONYMS.map(normalizeArabic);

// ── Acceptance rule (Tier strict) ────────────────────────────────────────────
// Returns 'direct' | 'ingredient' | 'fallback' | null.
// null means the block is rejected (excluded from results).
function classifyBlock(hits) {
  const conceptHits = hits.canonical.length + hits.strong.length + hits.related.length;

  // DIRECT: 1+ canonical hit, OR 2+ strong matches (dish→ingredient routing).
  if (hits.canonical.length > 0) return 'direct';
  if (hits.strong.length >= 2)  return 'direct';

  // INGREDIENT: a strong match counts on its own (density + verdict bonuses
  // handle relevance ranking). Previously required 2 concept hits total which
  // discarded blocks where Dr Dia talks ABOUT the ingredient densely.
  if (hits.strong.length > 0) return 'ingredient';

  // FALLBACK: no canonical AND no strong, but >=2 distinct related concepts.
  if (hits.strong.length === 0 && hits.canonical.length === 0 && hits.related.length >= 2) {
    return 'fallback';
  }

  return null;
}

// ── Intent detection ─────────────────────────────────────────────────────────
// Cheap pre-normalize-once detection: positive intent (whole/natural/original)
// or negative intent (white/refined/industrial). Used to bias scoring toward
// blocks whose doctrine_position aligns with the user's framing.
const POSITIVE_QUERY_TOKENS = ['كامل', 'الاصلي', 'اصلي', 'طبيعي', 'حبه كامله'];
const NEGATIVE_QUERY_TOKENS = ['ابيض', 'الابيض', 'مكرر', 'المكرر', 'صناعي', 'الصناعي', 'مصنع'];
const GOOD_POSITIONS = new Set(['good', 'good_natural', 'good_for_dr_dia_system', 'natural', 'fasting']);
const BAD_POSITIONS  = new Set(['bad', 'bad_industrial']);

// ── Main retrieval ────────────────────────────────────────────────────────────
export function retrieveBlocks(question, topN = 3) {
  const concepts = detectConceptsCached(question);

  const hasAnyConcept = concepts.canonical_foods.length > 0
                    || concepts.strong_matches.length > 0
                    || concepts.related_concepts.length > 0;
  if (!hasAnyConcept) return [];

  // Detect query polarity intent.
  const qn = normalizeArabic(question);
  const isPositiveQuery = POSITIVE_QUERY_TOKENS.some(t => qn.includes(t));
  const isNegativeQuery = NEGATIVE_QUERY_TOKENS.some(t => qn.includes(t));

  // ── Candidate selection via inverted index (replaces full scan) ──────────
  // Union all blocks that contain ANY of the question's concepts (any category).
  // Pre-normalize concept terms once here (avoids repeated normalizeArabic calls
  // during the per-block scoring loop below).
  const canonicalNorm  = concepts.canonical_foods.map(normalizeArabic);
  const strongNorm     = concepts.strong_matches.map(normalizeArabic);
  const relatedNorm    = concepts.related_concepts.map(normalizeArabic);

  const candidateIds = new Set();
  const allTermsNorm = [
    ...canonicalNorm,
    ...strongNorm,
    ...relatedNorm,
    ...GENERIC_SYNONYMS_NORM,
  ];
  for (const tn of allTermsNorm) {
    const set = ANCHOR_BLOCK_SETS[tn];
    if (!set) continue;
    for (const id of set) candidateIds.add(id);
  }

  if (candidateIds.size === 0) return [];

  // ── Scoring (replaces text-scan scoreBlockV3 with set-membership checks) ──
  const scoredAll = [];
  for (const id of candidateIds) {
    const block = BLOCK_MAP.get(id);
    if (!block) continue;

    // Use pre-normalized arrays — O(1) set lookups, no normalizeArabic per block.
    const hits = {
      canonical: concepts.canonical_foods.filter((_, i) =>
        ANCHOR_BLOCK_SETS[canonicalNorm[i]]?.has(id)
      ),
      strong: concepts.strong_matches.filter((_, i) =>
        ANCHOR_BLOCK_SETS[strongNorm[i]]?.has(id)
      ),
      related: concepts.related_concepts.filter((_, i) =>
        ANCHOR_BLOCK_SETS[relatedNorm[i]]?.has(id)
      ),
      generic: GENERIC_SYNONYMS.filter((_, i) =>
        ANCHOR_BLOCK_SETS[GENERIC_SYNONYMS_NORM[i]]?.has(id)
      ),
    };

    let score = 0;
    score += hits.canonical.length * 30;
    score += hits.strong.length    * 20;
    score += hits.related.length   * 10;
    score += hits.generic.length   *  5;
    score += DOMAIN_SCORE[block.domain] ?? 0;

    // Density bonus: a block that mentions the canonical/strong food N times is
    // more "about" it than one that mentions it once. Multipliers are small
    // (3/2) to avoid drowning out the curated db_resume blocks. Curated blocks
    // get a +25 doctrine boost so they keep ranking priority over high-density
    // raw blocks.
    if (hits.canonical.length > 0 || hits.strong.length > 0) {
      const normRaw = BLOCK_NORM_RAW.get(id);
      if (normRaw) {
        let densityBonus = 0;
        for (let i = 0; i < canonicalNorm.length; i++) {
          if (!ANCHOR_BLOCK_SETS[canonicalNorm[i]]?.has(id)) continue;
          const occ = normRaw.split(canonicalNorm[i]).length - 1;
          densityBonus += Math.min(occ, 6) * 3;
        }
        for (let i = 0; i < strongNorm.length; i++) {
          if (!ANCHOR_BLOCK_SETS[strongNorm[i]]?.has(id)) continue;
          const occ = normRaw.split(strongNorm[i]).length - 1;
          densityBonus += Math.min(occ, 6) * 2;
        }
        score += densityBonus;
      }
      const simpleNorm = DB_RESUME_NORM.get(id);
      if (simpleNorm) {
        let relevant = false;
        for (const cn of canonicalNorm) {
          if (simpleNorm.includes(cn)) { relevant = true; break; }
        }
        if (!relevant) {
          for (const sn of strongNorm) {
            if (simpleNorm.includes(sn)) { relevant = true; break; }
          }
        }
        if (relevant) {
          score += 25;
          // Verdict blocks (good/bad/natural) outrank neutral expert blocks
          // when both have a relevant db_resume.
          if (VERDICT_BLOCKS.has(id)) score += 35;
          // Intent alignment: positive query → boost good-doctrine blocks,
          // negative query → boost bad-doctrine blocks. Disambiguates
          // ambiguous topics (whole vs white bread, natural vs industrial sugar).
          const pos = dbResumePatch[id]?.doctrine_position;
          if (isPositiveQuery && GOOD_POSITIONS.has(pos)) score += 30;
          if (isNegativeQuery && BAD_POSITIONS.has(pos))  score += 30;
        }
      }
    }

    if (score <= 0) continue;

    const source = classifyBlock(hits);
    if (source === null) continue;

    scoredAll.push({ score, hits, block, concepts, confidence_source: source });
  }

  scoredAll.sort((a, b) => b.score - a.score);

  // Tier pools: direct > ingredient > fallback. Same logic as previous V3.
  const poolDirect     = scoredAll.filter(x => x.confidence_source === 'direct');
  const poolIngredient = scoredAll.filter(x => x.confidence_source === 'ingredient');
  const poolFallback   = scoredAll.filter(x => x.confidence_source === 'fallback');

  let activePool;
  // If poolDirect's best is weak (< 90 — no verdict block won) AND
  // poolIngredient has a stronger candidate, prefer ingredient pool. This
  // lets a high-density verdict block (e.g., الخضار for السلطة query) beat
  // a low-relevance direct match (e.g., testimonial mentioning سلطة once).
  const topDirect     = poolDirect[0]?.score     ?? 0;
  const topIngredient = poolIngredient[0]?.score ?? 0;
  if      (poolDirect.length > 0 && (topDirect >= 90 || topDirect >= topIngredient)) activePool = poolDirect;
  else if (poolIngredient.length > 0) activePool = poolIngredient;
  else if (poolDirect.length     > 0) activePool = poolDirect;
  else if (poolFallback.length   > 0) activePool = poolFallback;
  else                                activePool = [];

  // Diversity dedup on the active pool (same as V3).
  const seen = new Set();
  const primary = [];
  const backup = [];
  for (const item of activePool) {
    const vid = item.block.video_id;
    if (!seen.has(vid)) { seen.add(vid); primary.push(item); }
    else                { backup.push(item); }
  }
  const seenPrefix = new Set();
  const candidates = [];
  for (const item of [...primary, ...backup]) {
    const key = BLOCK_RAW_QUOTE_KEY.get(item.block.id) ?? normalizeArabic(item.block.raw_quote).slice(0, 100);
    if (seenPrefix.has(key)) continue;
    seenPrefix.add(key);
    candidates.push(item);
    if (candidates.length >= topN) break;
  }
  return candidates;
}

// ── Response builder ──────────────────────────────────────────────────────────
export function buildV2Response(question, results, videoMap, opts = {}) {
  const debug = !!opts.debug;

  const best = results[0];
  if (!best) {
    return {
      answer: 'لم أجد مقطعاً واضحاً من كلام الدكتور ضياء حول هذا السؤال.',
      sources: [],
      mode: 'v3_no_result',
      confidence_retrieval: 'none',
      confidence_source: null,
      understanding: null,
      db_resume: null,
      raw_quote: null,
      evidence: [],
      video_url: null,
    };
  }

  const concepts = best.concepts;
  const anchors = [
    ...concepts.canonical_foods.map(normalizeArabic),
    ...concepts.strong_matches.map(normalizeArabic),
  ];

  const blk = best.block;
  const vid = videoMap.get(blk.video_id) || {};
  const t = Math.floor(blk.timestamp_s || 0);
  const rawId = blk.video_id.replace('yt-', '');
  const video_url = `https://youtu.be/${rawId}?t=${t}`;

  const rawSnippet = buildSnippet(blk.raw_quote, anchors, 400);

  // db_resume patch: object {verdict, simple, explanation?} per Phase Finale.
  // Legacy string entries are coerced to {verdict: 'PASS_SIMPLE', simple: <string>}.
  let dbResume = dbResumePatch[blk.id] || null;
  if (typeof dbResume === 'string') {
    dbResume = { verdict: 'PASS_SIMPLE', simple: dbResume };
  }
  const dbResumeSimple = dbResume?.simple || null;

  // ── Composed-dish prefix (extended logic per Task 5 TODO) ─────────────────
  // Case 1: canonical detected but no canonical matched in best block.
  // Case 2: principal canonical missing even though a secondary canonical matched.

  function isPrincipalCanonical(canonicalName) {
    const entry = dictionary[canonicalName];
    if (!entry) return false;
    return entry.type === 'dish' || (entry.strong_matches && entry.strong_matches.length > 0);
  }

  const principalsInQuestion = concepts.canonical_foods.filter(isPrincipalCanonical);
  const missingPrincipals = principalsInQuestion.filter(c => !best.hits.canonical.includes(c));

  let prefix = '';
  if (missingPrincipals.length > 0) {
    // Case 2 (multi-canonical) OR case 1 when the missing canonical is principal.
    const head = missingPrincipals[0];
    const dishEntry = dictionary[head] || {};
    const validIngredients = (dishEntry.strong_matches || []).filter(s =>
      best.hits.strong.includes(s)
    );
    const ingredient = validIngredients[0] || best.hits.strong[0] || best.hits.related[0] || '';
    if (ingredient) {
      prefix = `لم أجد كلاماً مباشراً للدكتور ضياء عن "${head}" تحديداً، لكنّه تكلّم عن المكوّن الأساسي (${ingredient}):\n\n`;
    } else {
      prefix = `لم أجد كلاماً مباشراً للدكتور ضياء عن "${head}" تحديداً، لكن:\n\n`;
    }
  } else if (concepts.canonical_foods.length > 0 && best.hits.canonical.length === 0) {
    // Edge case: canonicals detected, none are "principal" (e.g., all are simple foods
    // like السكر), AND none matched the block. Use the first canonical.
    const head = concepts.canonical_foods[0];
    const ingredient = best.hits.strong[0] || best.hits.related[0] || '';
    if (ingredient) {
      prefix = `لم أجد كلاماً مباشراً للدكتور ضياء عن "${head}" تحديداً، لكنّه تكلّم عن المكوّن الأساسي (${ingredient}):\n\n`;
    } else {
      prefix = `لم أجد كلاماً مباشراً للدكتور ضياء عن "${head}" تحديداً، لكن:\n\n`;
    }
  }

  // db_resume.simple already starts with the canonical prefix "بحسب كلام الدكتور ضياء،"
  // (enforced by the soft-check test). Use it directly, no extra intro.
  // For raw snippet fallback, prepend an intro line.
  const intro = dbResumeSimple
    ? dbResumeSimple
    : 'وجدت مقطعاً من كلام الدكتور ضياء:\n\n' + `"${rawSnippet}"`;

  const answer = [
    prefix + intro,
    '',
    `📍 ${blk.timestamp} — ${vid.title_original || blk.video_id}`,
    `🔗 ${video_url}`,
  ].join('\n');

  const sources = results.map(({ score, block }) => {
    const v = videoMap.get(block.video_id) || {};
    const ts = Math.floor(block.timestamp_s || 0);
    const rid = block.video_id.replace('yt-', '');
    return {
      id: block.id,
      title: v.title_original || block.video_id,
      url: `https://youtu.be/${rid}?t=${ts}`,
      timestamp: block.timestamp,
      summary_ar: '',                                    // ignored Phase A
      quote: buildSnippet(block.raw_quote, anchors, 300),
      domain: block.domain,
      topic: block.topic,
      score,
    };
  });

  const evidence = results.map(({ score, block, confidence_source }) => {
    const ts = Math.floor(block.timestamp_s || 0);
    const rid = block.video_id.replace('yt-', '');
    return {
      block_id: block.id,
      timestamp: block.timestamp,
      timestamp_s: block.timestamp_s,
      video_id: block.video_id,
      video_url: `https://youtu.be/${rid}?t=${ts}`,
      score,
      pool_tier: confidence_source === 'fallback' ? 2 : 1,
    };
  });

  const score = best.score;
  const confidence_retrieval =
    score >= 30 ? 'high' :
    score >= 15 ? 'medium' :
    'low';

  const mode = dbResumeSimple ? 'v3_db_resume' : 'v3_raw_fallback';

  const payload = {
    answer,
    sources,
    mode,
    confidence_retrieval,
    confidence_source: best.confidence_source,
    understanding: {
      canonical_foods: concepts.canonical_foods,
      strong_matches: concepts.strong_matches,
      related_concepts: concepts.related_concepts,
      expanded_terms: concepts.expanded_terms,
      human_readable_ar: concepts.human_readable_ar,
      dialect_hint: concepts.dialect_hint,
    },
    raw_quote: rawSnippet,
    db_resume: dbResume,
    evidence,
    video_url,
  };

  if (debug) {
    payload.debug = {
      pool_tier: best.confidence_source === 'fallback' ? 2 : 1,
      anchors_question: concepts.expanded_terms,
      tier1_pool_size: results.filter(r => r.confidence_source !== 'fallback').length,
      tier2_pool_size: results.filter(r => r.confidence_source === 'fallback').length,
      excluded_count: -1, // not tracked at this layer; leave -1
      top_scores: results.map(r => r.score),
      winning_block_id: blk.id,
      has_db_resume: !!dbResume,
      hits: best.hits,
    };
  }

  return payload;
}
