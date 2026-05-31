/**
 * retrieval_v2.js — Phase 2 retrieval, 0 API calls.
 * Pure keyword scoring on knowledge_raw.json.
 * Endpoint: POST /api/chat_v2
 */
import knowledgeRaw from './knowledge_index.json';
import dictionary from './dialect_food_dictionary.json';
import dbResumePatch from './knowledge_db_resume_patch.json';
import {
  normalizeArabic as _normalizeArabic,
  tokenize as _tokenize,
  anchorMatchesToken as _anchorMatchesToken,
  textHasAnchor as _textHasAnchor,
  detectConcepts,
} from './query_understanding.js';

// ── Arabic normalization ──────────────────────────────────────────────────────
const _TASHKEEL = /[ً-ٰٟ]/g;
const _PUNCT    = /[؟?!.،,؛:]/g;

function norm(text) {
  return text
    .replace(_TASHKEEL, '')
    .replace(_PUNCT, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();
}

function wordSet(text) {
  return new Set(norm(text).split(/\s+/).filter(Boolean));
}

const STOP = new Set([
  'هل','ما','ماذا','كيف','لماذا','هو','هي','في','من','على','ان','أن','إن',
  'لل','و','أو','او','لا','مع','عن','الى','إلى','هذا','هذه','ذلك','تلك',
  'كان','يكون','انت','أنت','انا','أنا','لمريض','لمرضى','مريض','صحي','افضل',
  'ينفع','مناسب','ترفع','تناول','يعني',
]);

// ── Synonym expansion ─────────────────────────────────────────────────────────
const SYNONYMS = {
  'سكر':       ['سكر','سكري','جلوكوز','هيموجلوبين','hba1c','سكريات'],
  'انسولين':   ['انسولين','مقاومه الانسولين','مقاومة الانسولين'],
  'بطاطس':     ['بطاطس','بطاطا','بطاط'],
  'خبز':       ['خبز','عيش','دقيق','قمح','رغيف','مخبوزات'],
  'رز':        ['رز','ارز'],
  'تمر':       ['تمر','بلح','رطب'],
  'عسل':       ['عسل'],
  'صيام':      ['صيام','صوم','صايم','رمضان','متقطع','انترمتنت'],
  'كوليسترول': ['كوليسترول','كولسترول','ldl','hdl','ترايجليسرايد'],
  'بروتين':    ['بروتين','امينو','كولاجين'],
  'دهون':      ['دهون','دهن','شحم','دهني'],
  'كبد':       ['كبد','كبده'],
  'التهاب':    ['التهاب','التهابات','انفلاماشن'],
};

export function expandQuery(question) {
  const n   = norm(question);
  const qWs = new Set(n.split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)));
  const exp = new Set(qWs);
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    const kn = norm(key);
    if (qWs.has(kn) || syns.some(s => n.includes(norm(s)))) {
      syns.forEach(s => exp.add(norm(s)));
    }
  }
  return { qWs, exp, nq: n };
}

// ── Word-boundary anchor matching ─────────────────────────────────────────────
// Anchors are matched as TOKENS (whole words) with optional Arabic prefix
// stripping, NOT as substrings. This avoids false positives like ورزقنا
// (sustenance) registering as a hit for رز (rice).
const _AR_PREFIXES = ['', 'ال','و','ف','ب','ل','ك','س',
                      'وال','فال','بال','كال','ولا','وب','ول','فل','بل','لل'];
const _AR_SUFFIXES = ['', 'ه','ها','هم','هن','ي','ك','كم','كن','نا',
                      'ات','ون','ين','يه','تي','ها','هما'];

function anchorMatchesToken(token, anchor) {
  for (const p of _AR_PREFIXES) {
    if (!token.startsWith(p)) continue;
    const rest = token.slice(p.length);
    for (const sfx of _AR_SUFFIXES) {
      if (rest === anchor + sfx) return true;
    }
  }
  return false;
}

function textHasAnchor(normalizedText, anchor) {
  for (const tok of normalizedText.split(/\s+/)) {
    if (tok && anchorMatchesToken(tok, anchor)) return true;
  }
  return false;
}

function findAnchorPosInRaw(rawQuote, anchors) {
  // Walk the raw_quote tokens; return the raw_quote index of the first
  // token (after normalization) that matches any anchor.
  const re = /\S+/g;
  let m;
  while ((m = re.exec(rawQuote)) !== null) {
    const tok = norm(m[0]);
    for (const a of anchors) {
      if (anchorMatchesToken(tok, a)) return m.index;
    }
  }
  return -1;
}

// ── Specificity boost ─────────────────────────────────────────────────────────
// If the query targets a specific food/concept, blocks that contain it score +12.
// This prevents the generic mega-block from winning over specific food blocks.
const _SPECIFIC_ANCHORS = [
  'بطاطس','بطاطا','بطاط',
  'رز','ارز',
  'تمر','بلح','رطب',
  'عسل',
  'صيام','صوم','صايم','رمضان','متقطع',
  'كوليسترول','كولسترول',
  'دهون','دهن','شحم',
].map(norm);

const SPECIFICITY_BOOST = 12;

function applySpecificityBoost(pool, nq) {
  // Detect anchor terms in the question via word-aware matching
  const anchors = _SPECIFIC_ANCHORS.filter(a => textHasAnchor(nq, a));
  if (anchors.length === 0) return pool;

  return pool
    .map(item => {
      const rawN = norm(item.block.raw_quote);
      const hasAnchor = anchors.some(a => textHasAnchor(rawN, a));
      return hasAnchor ? { ...item, score: item.score + SPECIFICITY_BOOST } : item;
    })
    .sort((a, b) => b.score - a.score);
}

// ── Scoring ───────────────────────────────────────────────────────────────────
const DOMAIN_SCORE = { nutrition: 3, medical: 1, off_topic: -20, general: 0 };

function scoreBlock(block, qWs, exp) {
  const rw = wordSet(block.raw_quote);
  let s = 0;
  for (const w of qWs)              if (rw.has(w))                     s += 3;
  for (const w of exp)              if (!qWs.has(w) && rw.has(w))      s += 2;
  for (const kw of (block.keywords || [])) if (exp.has(norm(kw)))      s += 2;
  for (const t  of (block.topic    || []))
    if ([...exp].some(w => norm(t).includes(w)))                        s += 1;
  s += DOMAIN_SCORE[block.domain] ?? 0;
  return s;
}


// ── Snippet centering ─────────────────────────────────────────────────────────
// When the question targets a specific food/concept, show the part of the
// raw_quote AROUND that anchor instead of the first 400 chars (which is often
// an off-topic intro).
export function findAnchors(nq) {
  return _SPECIFIC_ANCHORS.filter(a => textHasAnchor(nq, a));
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
  const { qWs, exp, nq } = expandQuery(question);

  const scored = knowledgeRaw
    .filter(b => b.domain !== 'off_topic')
    .map(b    => ({ score: scoreBlock(b, qWs, exp), block: b }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const nutrition = scored.filter(x => x.block.domain === 'nutrition');
  const pool      = applySpecificityBoost(
    nutrition.length > 0 ? nutrition : scored,
    nq
  );

  // Diversity: max 1 block per video_id in primary pass; pad with 2nd blocks if needed
  const seen    = new Set();
  const primary = [];
  const backup  = [];
  for (const item of pool) {
    const vid = item.block.video_id;
    if (!seen.has(vid)) {
      seen.add(vid);
      primary.push(item);
    } else {
      backup.push(item);
    }
  }

  // Build candidate list with raw_quote prefix dedup so near-duplicate
  // transcripts (same content, different video_id) don't both surface.
  const seenPrefix = new Set();
  const candidates = [];
  for (const item of [...primary, ...backup]) {
    const key = norm(item.block.raw_quote).slice(0, 100);
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
  const nq      = norm(question);
  const anchors = findAnchors(nq);
  const quote   = buildSnippet(blk.raw_quote, anchors, 400);

  const summary = blk.summary_ar || '';
  const answer = summary
    ? ['بحسب كلام الدكتور ضياء:', '', summary, '', `📍 ${blk.timestamp} — ${vid.title_original || blk.video_id}`, `🔗 ${link}`].join('\n')
    : ['وجدت مقطعاً من كلام الدكتور ضياء:', '', `"${quote}"`, '', `📍 ${blk.timestamp} — ${vid.title_original || blk.video_id}`, `🔗 ${link}`].join('\n');

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
