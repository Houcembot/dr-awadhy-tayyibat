// tests/run_doctorine_quiz.mjs
// Doctrine Drift Test — vérifie que Tayyibat répond selon Dr Diaa,
// pas comme nutrition classique / ChatGPT généraliste.
//
// Verdicts par question :
//   PASS              — réponse contient au moins un terme must_include_any,
//                       ET aucun terme must_not_include_any (doctrine inverse).
//   FAIL_DRIFT        — réponse contient un terme must_not_include_any
//                       (doctrine inverse détectée — bug critique).
//   MISSING_EVIDENCE  — mode v3_no_result OU réponse ne contient aucun terme
//                       must_include_any (la DB ne couvre pas ce sujet
//                       avec un angle Dr Diaa).
//
// Le test ne marque JAMAIS PASS si la réponse est généraliste — il préfère
// MISSING_EVIDENCE à un faux positif.
//
// Run: cd chat-worker && npx vite-node tests/run_doctorine_quiz.mjs

import { retrieveBlocks, buildV2Response } from '../src/retrieval_v2.js';
import videos from '../src/videos.json' with { type: 'json' };
import questions from './doctorine_quiz_questions.json' with { type: 'json' };
import expected_arr from './doctorine_quiz_expected.json' with { type: 'json' };

const videoMap = new Map(videos.map(v => [v.id, v]));
const expectedById = new Map(expected_arr.map(e => [e.id, e]));

let nPass = 0, nFailDrift = 0, nMissing = 0;
const failDriftDetails = [];
const missingDetails = [];

console.log('═'.repeat(80));
console.log('DOCTRINE DRIFT TEST — Tayyibat fidelity to Dr Diaa');
console.log('═'.repeat(80));
console.log();

for (const q of questions) {
  const exp = expectedById.get(q.id);
  if (!exp) {
    console.log(`⚠️  [${q.id}] expected entry missing in doctorine_quiz_expected.json`);
    continue;
  }

  const results = retrieveBlocks(q.question_ar);
  const payload = buildV2Response(q.question_ar, results, videoMap);

  // Use the user-visible answer text for evaluation (it includes prefix +
  // db_resume.simple OR raw_quote snippet).
  const text = payload.answer || '';
  const textNorm = text;

  // Look for forbidden patterns first (doctrine drift = critical fail)
  const driftHits = exp.must_not_include_any.filter(t => textNorm.includes(t));
  // Look for required patterns
  const includeHits = exp.must_include_any.filter(t => textNorm.includes(t));

  let verdict;
  if (payload.mode === 'v3_no_result') {
    verdict = 'MISSING_EVIDENCE';
    nMissing++;
    missingDetails.push({ id: q.id, reason: 'v3_no_result' });
  } else if (driftHits.length > 0) {
    verdict = 'FAIL_DRIFT';
    nFailDrift++;
    failDriftDetails.push({
      id: q.id,
      question: q.question_ar,
      drift_terms: driftHits,
      mode: payload.mode,
      answer_preview: text.slice(0, 250),
    });
  } else if (includeHits.length > 0) {
    verdict = 'PASS';
    nPass++;
  } else {
    verdict = 'MISSING_EVIDENCE';
    nMissing++;
    missingDetails.push({
      id: q.id,
      reason: 'no must_include match',
      mode: payload.mode,
      answer_preview: text.slice(0, 200),
    });
  }

  // Per-question report
  const icon = verdict === 'PASS' ? '✓' : verdict === 'FAIL_DRIFT' ? '✗' : '?';
  console.log(`${icon} [${q.id.padEnd(20)}] ${verdict.padEnd(18)} mode=${payload.mode}`);
  console.log(`    Q:        ${q.question_ar}`);
  console.log(`    expected: ${exp.expected_position}`);
  if (includeHits.length > 0) {
    console.log(`    ✓ include hits: ${JSON.stringify(includeHits)}`);
  }
  if (driftHits.length > 0) {
    console.log(`    ✗ DRIFT terms detected: ${JSON.stringify(driftHits)}`);
  }
  if (verdict !== 'PASS') {
    console.log(`    answer(180): ${text.replace(/\n/g, ' | ').slice(0, 180)}`);
  }
  console.log();
}

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log(`  PASS              : ${nPass}/${questions.length}`);
console.log(`  FAIL_DRIFT        : ${nFailDrift}/${questions.length}  ${nFailDrift > 0 ? '⚠️  DOCTRINE INVERSE DÉTECTÉE — bug critique' : ''}`);
console.log(`  MISSING_EVIDENCE  : ${nMissing}/${questions.length}  (DB ne couvre pas — Étape 5+ enrichira)`);
console.log();

if (failDriftDetails.length > 0) {
  console.log('─── FAIL_DRIFT details ───');
  for (const d of failDriftDetails) {
    console.log(`  [${d.id}] drift terms: ${JSON.stringify(d.drift_terms)}`);
    console.log(`    Q:      ${d.question}`);
    console.log(`    mode:   ${d.mode}`);
    console.log(`    answer: ${d.answer_preview.replace(/\n/g, ' | ')}`);
    console.log();
  }
}

if (missingDetails.length > 0 && missingDetails.length < 8) {
  console.log('─── MISSING_EVIDENCE details (first 8) ───');
  for (const d of missingDetails.slice(0, 8)) {
    console.log(`  [${d.id}] ${d.reason}`);
  }
}

// Exit code: 0 if no drift, 1 if drift detected (CI fail)
process.exit(nFailDrift > 0 ? 1 : 0);
