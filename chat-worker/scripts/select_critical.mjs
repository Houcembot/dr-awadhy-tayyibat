// scripts/select_critical.mjs
// Identifies 20 critical blocks for db_resume generation.
// Runs V3 retrieval on 12 obligatory questions (top-1 each) + 10 sweep queries
// (top-2 each) and deduplicates by block.id.
//
// Selection strategy:
//   - obligatory questions: top-1 each → guarantees coverage of the 12 spec questions
//   - sweep queries: top-2 each → broader thematic coverage
//   - dedupe by block.id
//   - cap at 20 by descending score (obligatories tend to score highest)
//
// Outputs:
//   /tmp/db_resume_candidates.json — structured info per block
//   /tmp/db_resume_ids.txt         — comma-separated block IDs (for piping to Python)
//
// Run: cd chat-worker && npx vite-node scripts/select_critical.mjs

import { retrieveBlocks } from '../src/retrieval_v2.js';
import fs from 'node:fs';

const OBLIGATORY_QUESTIONS = [
  'هل العسل صحي؟',
  'هل العيش ينفع؟',
  'هل الخبز صحي؟',
  'هل البطاطس ترفع السكر؟',
  'هل التمر يرفع السكر؟',
  'هل الرز مناسب لمريض السكر؟',
  'هل الكسكسي ينفع؟',
  'هل المقروض يرفع السكر؟',
  'هل الكشري صحي؟',
  'هل السلطة صحية؟',
  'هل البريك صحي؟',
  'هل الزلابية ترفع السكر؟',
];

// 10 sweep queries — broader thematic coverage. User-approved list (Task 1 brief).
const SWEEP_QUERIES = [
  'هل السكر صحي؟',
  'هل الخبز يضر؟',
  'هل الصيام صحي؟',
  'هل الدهون مضرة؟',
  'هل التمر مفيد للصيام؟',
  'هل البطاطس مفيدة؟',
  'هل الرز يضر؟',
  'هل العسل مفيد؟',
  'ما هو الكوليسترول؟',
  'ما هي مقاومة الأنسولين؟',
];

const SWEEP_TOPN = 2;  // top-2 per sweep query

const candidates = new Map();  // block.id → record

function addCandidate(item, sourceQuery, sourceType) {
  const id = item.block.id;
  if (candidates.has(id)) {
    // Already added — record secondary source for transparency
    candidates.get(id).also_matched.push({ source: sourceType, query: sourceQuery });
    return;
  }
  candidates.set(id, {
    id,
    video_id: item.block.video_id,
    timestamp: item.block.timestamp,
    timestamp_s: item.block.timestamp_s,
    topic: item.block.topic,
    keywords: item.block.keywords,
    domain: item.block.domain,
    raw_quote: item.block.raw_quote,
    raw_quote_preview: item.block.raw_quote.slice(0, 400),
    score: item.score,
    confidence_source: item.confidence_source,
    primary_source: { source: sourceType, query: sourceQuery },
    also_matched: [],
  });
}

// Phase A: obligatory questions, top-1 each
console.log('═══ Phase A: 12 obligatory questions (top-1 each) ═══');
let oblFound = 0;
for (const q of OBLIGATORY_QUESTIONS) {
  const results = retrieveBlocks(q, 1);
  if (results.length > 0) {
    addCandidate(results[0], q, 'obligatory');
    oblFound++;
  } else {
    console.log(`  (no result for: ${q})`);
  }
}
console.log(`  ${oblFound}/${OBLIGATORY_QUESTIONS.length} obligatory questions yielded a result`);

// Phase B: sweep queries, top-2 each
console.log(`\n═══ Phase B: 10 sweep queries (top-${SWEEP_TOPN} each) ═══`);
let sweepAdded = 0;
for (const q of SWEEP_QUERIES) {
  const results = retrieveBlocks(q, SWEEP_TOPN);
  for (const r of results) {
    const before = candidates.size;
    addCandidate(r, q, 'sweep');
    if (candidates.size > before) sweepAdded++;
  }
}
console.log(`  ${sweepAdded} new unique blocks from sweep phase (dedupe applied)`);

const all = [...candidates.values()];
console.log(`\n═══ Pool size before truncation ═══`);
console.log(`  ${all.length} unique blocks total`);

// Truncate to top 20 by score (obligatories tend to score highest, so they survive).
all.sort((a, b) => b.score - a.score);
const top20 = all.slice(0, 20);
console.log(`  Truncated to top 20 by score`);

// Theme coverage analysis
console.log(`\n═══ Theme coverage analysis ═══`);
const themeBuckets = {
  sugar:        0,  // any source query mentions السكر / سكر / سكري
  bread:        0,  // الخبز / العيش
  potato:       0,  // البطاطس
  rice:         0,  // الرز
  date:         0,  // التمر
  honey:        0,  // العسل
  fasting:      0,  // الصيام
  fat:          0,  // الدهون / الكوليسترول
  insulin:      0,  // مقاومة الأنسولين
  composed:     0,  // كسكسي / مقروض / كشري / بريك / زلابية / سلطة
  other:        0,
};

function classifyTheme(c) {
  const queries = [c.primary_source.query, ...c.also_matched.map(m => m.query)].join(' ');
  if (/كسكسي|مقروض|كشري|بريك|زلابية|سلطة/.test(queries)) return 'composed';
  if (/سكر|سكري/.test(queries)) return 'sugar';
  if (/خبز|عيش/.test(queries)) return 'bread';
  if (/بطاطس/.test(queries)) return 'potato';
  if (/رز/.test(queries)) return 'rice';
  if (/تمر|بلح/.test(queries)) return 'date';
  if (/عسل/.test(queries)) return 'honey';
  if (/صيام|صوم/.test(queries)) return 'fasting';
  if (/دهون|كوليسترول/.test(queries)) return 'fat';
  if (/انسولين|أنسولين/.test(queries)) return 'insulin';
  return 'other';
}

for (const c of top20) {
  themeBuckets[classifyTheme(c)]++;
}
for (const [theme, n] of Object.entries(themeBuckets)) {
  if (n > 0) console.log(`  ${theme.padEnd(10)}: ${n}`);
}

// Video/timestamp dedup analysis
console.log(`\n═══ Video diversity ═══`);
const videoCounts = {};
for (const c of top20) {
  videoCounts[c.video_id] = (videoCounts[c.video_id] || 0) + 1;
}
const repeated = Object.entries(videoCounts).filter(([_, n]) => n > 1);
console.log(`  Unique videos: ${Object.keys(videoCounts).length}/20`);
if (repeated.length > 0) {
  console.log(`  Videos with multiple blocks:`);
  for (const [vid, n] of repeated) {
    const ts = top20.filter(c => c.video_id === vid).map(c => c.timestamp).join(', ');
    console.log(`    ${vid}: ${n} blocks @ ${ts}`);
  }
} else {
  console.log(`  ✓ Every block from a distinct video — perfect diversity`);
}

// Per-block "why selected" report
console.log(`\n═══ 20 candidates — why each was chosen ═══`);
for (let i = 0; i < top20.length; i++) {
  const c = top20[i];
  const alsoStr = c.also_matched.length > 0
    ? ` (+${c.also_matched.length} other queries)`
    : '';
  console.log(`[${(i+1).toString().padStart(2)}] ${c.id.padEnd(35)} score=${c.score} tier=${c.confidence_source}`);
  console.log(`     primary: ${c.primary_source.source.padEnd(11)} "${c.primary_source.query}"${alsoStr}`);
  console.log(`     topic:   ${JSON.stringify(c.topic)}`);
  console.log(`     quote(150 chars): ${c.raw_quote.slice(0, 150)}`);
  console.log();
}

// Write outputs
fs.writeFileSync('/tmp/db_resume_candidates.json',
  JSON.stringify(top20, null, 2));
fs.writeFileSync('/tmp/db_resume_ids.txt',
  top20.map(c => c.id).join(','));

console.log('═══ Files written ═══');
console.log('  /tmp/db_resume_candidates.json');
console.log('  /tmp/db_resume_ids.txt');
