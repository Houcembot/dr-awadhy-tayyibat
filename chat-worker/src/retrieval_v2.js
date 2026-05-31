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

// ── Main retrieval ────────────────────────────────────────────────────────────
export function retrieveBlocks(question, topN = 3) {
  const concepts = detectConcepts(question, dictionary);

  // Transitional: if dictionary detects nothing, fall back to a minimal
  // bag-of-words over the question to keep working on out-of-dictionary
  // queries. Task 4 will tighten this with the acceptance rule.
  const matchTerms = new Set([
    ...concepts.canonical_foods.map(normalizeArabic),
    ...concepts.strong_matches.map(normalizeArabic),
    ...concepts.related_concepts.map(normalizeArabic),
  ]);

  // Out-of-dictionary question → no_result direct. Avoids stop-word
  // false positives (هل/ما/هو/في as +5 scorers). The chatbot is
  // intentionally food-focused; non-food questions return v3_no_result.
  if (matchTerms.size === 0) {
    return [];
  }

  const scored = knowledgeRaw
    .filter(b => b.domain !== 'off_topic')
    .map(b => {
      let score = 0;
      for (const term of matchTerms) {
        if (textHasAnchor(b.raw_quote, term)) score += 5;
      }
      score += DOMAIN_SCORE[b.domain] ?? 0;
      return { score, block: b, concepts };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Diversity dedup (existing pattern, kept from V2)
  const seen = new Set();
  const primary = [];
  const backup = [];
  for (const item of scored) {
    const vid = item.block.video_id;
    if (!seen.has(vid)) {
      seen.add(vid);
      primary.push(item);
    } else {
      backup.push(item);
    }
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
