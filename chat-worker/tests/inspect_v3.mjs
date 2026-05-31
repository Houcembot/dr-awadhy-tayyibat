// Manual inspection script — NOT part of the vitest suite.
// Run with: npx vite-node tests/inspect_v3.mjs
import { retrieveBlocks, buildV2Response } from '../src/retrieval_v2.js';
import videos from '../src/videos.json' with { type: 'json' };

const videoMap = new Map(videos.map(v => [v.id, v]));

const QUESTIONS = [
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

let directCount = 0;
let ingredientCount = 0;
let fallbackCount = 0;
let noResultCount = 0;

for (const q of QUESTIONS) {
  const results = retrieveBlocks(q);
  const payload = buildV2Response(q, results, videoMap, { debug: true });

  console.log('═'.repeat(80));
  console.log('QUESTION:', q);
  console.log('  mode:', payload.mode);
  console.log('  confidence_retrieval:', payload.confidence_retrieval);
  console.log('  confidence_source:', payload.confidence_source);
  console.log('  understanding:');
  console.log('    canonical_foods:', JSON.stringify(payload.understanding?.canonical_foods));
  console.log('    strong_matches:',  JSON.stringify(payload.understanding?.strong_matches));
  console.log('    related:',         JSON.stringify(payload.understanding?.related_concepts));
  console.log('    dialect_hint:',    payload.understanding?.dialect_hint);
  console.log('  top blocks:');
  for (let i = 0; i < payload.sources.length; i++) {
    const s = payload.sources[i];
    const ev = payload.evidence[i];
    console.log(`    [${i}] score=${s.score} tier=${ev.pool_tier} ${s.id} @${s.timestamp}`);
    console.log(`        title: ${s.title}`);
    console.log(`        quote(200): ${s.quote.slice(0, 200)}`);
  }
  console.log('  best:');
  console.log('    db_resume:', payload.db_resume || '(none — Étape 4 will populate)');
  console.log('    raw_quote(400):', (payload.raw_quote || '').slice(0, 400));
  console.log('  why selected (debug.hits):', JSON.stringify(payload.debug?.hits));
  console.log('');
  console.log('--- ANSWER ---');
  console.log(payload.answer);
  console.log('');

  // Tally for the summary
  if (payload.mode === 'v3_no_result') noResultCount++;
  else if (payload.confidence_source === 'direct') directCount++;
  else if (payload.confidence_source === 'ingredient') ingredientCount++;
  else if (payload.confidence_source === 'fallback') fallbackCount++;
}

console.log('═'.repeat(80));
console.log('SUMMARY — 12 obligatory questions');
console.log(`  direct:     ${directCount}`);
console.log(`  ingredient: ${ingredientCount}`);
console.log(`  fallback:   ${fallbackCount}`);
console.log(`  no_result:  ${noResultCount}`);
console.log(`  total:      ${QUESTIONS.length}`);
console.log('');
console.log('Composed-dish strict-rule diagnostic (per Task 4 decision criterion):');
console.log('  Composed dishes in the question set:');
console.log('    الكسكسي, المقروض, الكشري, البريك, الزلابية');
console.log('  If >50% of these tomb en no_result MALGRÉ des citations DB pertinentes,');
console.log('  the strict acceptance rule should be relaxed. Otherwise, keep it.');
