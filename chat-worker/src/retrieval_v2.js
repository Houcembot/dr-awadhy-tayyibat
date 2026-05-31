/**
 * retrieval_v2.js — Phase 2 retrieval, 0 API calls.
 * Pure keyword scoring on knowledge_raw.json.
 * Endpoint: POST /api/chat_v2
 */
import knowledgeRaw from './knowledge_index.json';
import dictionary from './dialect_food_dictionary.json';
import dbResumePatch from './knowledge_db_resume_patch.json';
import {
  normalizeArabic,
  anchorMatchesToken,
  textHasAnchor,
  detectConcepts,
} from './query_understanding.js';

// ── Scoring ───────────────────────────────────────────────────────────────────
const DOMAIN_SCORE = { nutrition: 3, medical: 1, off_topic: -20, general: 0 };

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

function scoreBlockV3(block, concepts) {
  const hits = {
    canonical: [],
    strong:    [],
    related:   [],
    generic:   [],
  };

  for (const c of concepts.canonical_foods) {
    if (textHasAnchor(block.raw_quote, normalizeArabic(c))) {
      hits.canonical.push(c);
    }
  }
  for (const s of concepts.strong_matches) {
    if (textHasAnchor(block.raw_quote, normalizeArabic(s))) {
      hits.strong.push(s);
    }
  }
  for (const r of concepts.related_concepts) {
    if (textHasAnchor(block.raw_quote, normalizeArabic(r))) {
      hits.related.push(r);
    }
  }
  for (const g of GENERIC_SYNONYMS) {
    if (textHasAnchor(block.raw_quote, normalizeArabic(g))) {
      hits.generic.push(g);
    }
  }

  let score = 0;
  score += hits.canonical.length * 30;
  score += hits.strong.length    * 20;
  score += hits.related.length   * 10;
  score += hits.generic.length   *  5;
  score += DOMAIN_SCORE[block.domain] ?? 0;

  return { score, hits };
}

// ── Acceptance rule (Tier strict) ────────────────────────────────────────────
// Returns 'direct' | 'ingredient' | 'fallback' | null.
// null means the block is rejected (excluded from results).
function classifyBlock(hits) {
  const conceptHits = hits.canonical.length + hits.strong.length + hits.related.length;

  // DIRECT: 1+ canonical hit is enough.
  if (hits.canonical.length > 0) return 'direct';

  // INGREDIENT: no canonical, but a strong match AND >=2 distinct concepts total.
  if (hits.strong.length > 0 && conceptHits >= 2) return 'ingredient';

  // FALLBACK: no canonical AND no strong, but >=2 distinct related concepts.
  if (hits.strong.length === 0 && hits.canonical.length === 0 && hits.related.length >= 2) {
    return 'fallback';
  }

  return null;
}

// ── Main retrieval ────────────────────────────────────────────────────────────
export function retrieveBlocks(question, topN = 3) {
  const concepts = detectConcepts(question, dictionary);

  const hasAnyConcept = concepts.canonical_foods.length > 0
                    || concepts.strong_matches.length > 0
                    || concepts.related_concepts.length > 0;
  if (!hasAnyConcept) return [];

  const scoredAll = knowledgeRaw
    .filter(b => b.domain !== 'off_topic')
    .map(b => {
      const { score, hits } = scoreBlockV3(b, concepts);
      const source = classifyBlock(hits);
      return { score, hits, block: b, concepts, confidence_source: source };
    })
    .filter(x => x.confidence_source !== null && x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Tier pools: direct > ingredient > fallback.
  const poolDirect     = scoredAll.filter(x => x.confidence_source === 'direct');
  const poolIngredient = scoredAll.filter(x => x.confidence_source === 'ingredient');
  const poolFallback   = scoredAll.filter(x => x.confidence_source === 'fallback');

  let activePool;
  if      (poolDirect.length     > 0) activePool = poolDirect;
  else if (poolIngredient.length > 0) activePool = poolIngredient;
  else if (poolFallback.length   > 0) activePool = poolFallback;
  else                                activePool = [];

  // Diversity dedup on the active pool.
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
    const key = normalizeArabic(item.block.raw_quote).slice(0, 100);
    if (seenPrefix.has(key)) continue;
    seenPrefix.add(key);
    candidates.push(item);
    if (candidates.length >= topN) break;
  }
  return candidates;
}

// ── Response builder ──────────────────────────────────────────────────────────
export function buildV2Response(question, results, videoMap) {
  const best = results[0];
  if (!best || best.score < 8) {
    return {
      answer:     'لم أجد مقطعاً واضحاً من كلام الدكتور ضياء حول هذا السؤال.',
      sources:    [],
      mode:       'v2_no_result',
      confidence: 'none',
    };
  }

  const bestScore = best.score;
  const blk  = best.block;
  const vid  = videoMap.get(blk.video_id) || {};
  const t    = Math.floor(blk.timestamp_s || 0);
  const rawId = blk.video_id.replace('yt-', '');
  const link  = `https://youtu.be/${rawId}?t=${t}`;

  const concepts = best.concepts || detectConcepts(question, dictionary);
  const anchors = [
    ...concepts.canonical_foods.map(normalizeArabic),
    ...concepts.strong_matches.map(normalizeArabic),
  ];
  const quote = buildSnippet(blk.raw_quote, anchors, 400);

  const answer = [
    'وجدت مقطعاً من كلام الدكتور ضياء:',
    '',
    `"${quote}"`,
    '',
    `📍 ${blk.timestamp} — ${vid.title_original || blk.video_id}`,
    `🔗 ${link}`,
  ].join('\n');

  const sources = results.map(({ score, block }) => {
    const v  = videoMap.get(block.video_id) || {};
    const ts = Math.floor(block.timestamp_s || 0);
    const rid = block.video_id.replace('yt-', '');
    return {
      id:         block.video_id,
      title:      v.title_original || block.video_id,
      url:        `https://youtu.be/${rid}?t=${ts}`,
      timestamp:  block.timestamp,
      summary_ar: block.summary_ar || '',
      quote:      buildSnippet(block.raw_quote, anchors, 300),
      domain:     block.domain,
      topic:      block.topic,
      score,
    };
  });

  return {
    answer,
    sources,
    mode:       'v2_raw',
    confidence: bestScore >= 15 ? 'high' : bestScore >= 8 ? 'medium' : 'low',
  };
}
