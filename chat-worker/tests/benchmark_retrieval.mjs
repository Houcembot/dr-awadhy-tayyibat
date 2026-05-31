// tests/benchmark_retrieval.mjs
// Measure per-request CPU time on representative queries.
// Target: p95 < 5ms per retrieve+build call (safe for Workers free tier 10ms budget).
//
// Run: cd chat-worker && npx vite-node tests/benchmark_retrieval.mjs

import { retrieveBlocks, buildV2Response } from '../src/retrieval_v2.js';
import videos from '../src/videos.json' with { type: 'json' };

const videoMap = new Map(videos.map(v => [v.id, v]));

const QUERIES = [
  'هل السكر صحي؟',
  'هل الرز صحي؟',
  'هل البطاطس ترفع السكر؟',
  'هل العسل صحي؟',
  'هل المقروض يرفع السكر؟',
  'هل الكشري صحي؟',
  'هل البريك صحي؟',
  'هل الكسكسي ينفع؟',
  'ما هو الوقت الآن؟',
];

const TARGET_MS = 5;
const N_RUNS = 50;  // average over many runs to smooth noise

console.log(`Benchmarking ${QUERIES.length} queries × ${N_RUNS} runs each\n`);
console.log(`Target: p95 < ${TARGET_MS}ms per call\n`);
console.log('Query'.padEnd(40) + '  avg     p50     p95     max');
console.log('─'.repeat(80));

let allOk = true;
let overallMax = 0;

for (const q of QUERIES) {
  // Warm-up
  for (let i = 0; i < 5; i++) {
    const r = retrieveBlocks(q);
    buildV2Response(q, r, videoMap);
  }

  // Measure
  const times = [];
  for (let i = 0; i < N_RUNS; i++) {
    const t0 = performance.now();
    const r = retrieveBlocks(q);
    buildV2Response(q, r, videoMap);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const max = times[times.length - 1];
  overallMax = Math.max(overallMax, max);

  const ok = p95 < TARGET_MS;
  const icon = ok ? '✓' : '✗';
  if (!ok) allOk = false;

  console.log(
    `${icon} ${q.padEnd(38)}  ${avg.toFixed(2).padStart(5)}   ${p50.toFixed(2).padStart(5)}   ${p95.toFixed(2).padStart(5)}   ${max.toFixed(2).padStart(5)}`
  );
}

console.log('─'.repeat(80));
console.log(`\nOverall max across all queries: ${overallMax.toFixed(2)}ms`);
console.log(`Target threshold:               ${TARGET_MS}ms`);
console.log(allOk ? '\n✓ PASS — safe for Workers free tier' : '\n✗ FAIL — still over budget, refactor more');

// Exit code 0 if PASS, 1 if FAIL (so CI can flag regressions)
process.exit(allOk ? 0 : 1);
