import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { retrieveBlocks, buildV2Response } from '../src/retrieval_v2.js';
import videos from '../src/videos.json';
import quizQuestions from './doctorine_quiz_questions.json';

const videoMap = new Map(videos.map(v => [v.id, v]));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(__dirname, 'retrieval_invariant_baseline.json');

// Build the current snapshot — 15 doctrine questions, extract invariant fields.
function buildSnapshot() {
  const snap = {};
  for (const q of quizQuestions) {
    const results = retrieveBlocks(q.question_ar);
    const payload = buildV2Response(q.question_ar, results, videoMap);
    snap[q.id] = {
      question_ar: q.question_ar,
      top_block_id: results[0]?.block?.id ?? null,
      mode: payload.mode,
      confidence_retrieval: payload.confidence_retrieval,
      confidence_source: payload.confidence_source,
      db_resume: payload.db_resume ?? null,
    };
  }
  return snap;
}

describe('retrieval invariant — 15 doctrine questions', () => {
  it('matches baseline snapshot exactly (top_block_id, mode, confidence, db_resume)', () => {
    const current = buildSnapshot();

    // Bootstrap: if no baseline file yet, write it. The user reviews it
    // and the test will then assert against it on future runs.
    if (!fs.existsSync(BASELINE_FILE)) {
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2));
      console.log(`Baseline created: ${BASELINE_FILE}`);
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));

    // Assert every doctrine question's invariant fields match.
    for (const qid of Object.keys(baseline)) {
      expect(current[qid], `question ${qid} missing in current snapshot`).toBeDefined();
      const want = baseline[qid];
      const got  = current[qid];
      expect(got.top_block_id,         `${qid}: top_block_id drift`).toBe(want.top_block_id);
      expect(got.mode,                 `${qid}: mode drift`).toBe(want.mode);
      expect(got.confidence_retrieval, `${qid}: confidence_retrieval drift`).toBe(want.confidence_retrieval);
      expect(got.confidence_source,    `${qid}: confidence_source drift`).toBe(want.confidence_source);
      // db_resume comparison: deep equal via JSON normalize
      expect(JSON.stringify(got.db_resume), `${qid}: db_resume drift`).toBe(JSON.stringify(want.db_resume));
    }
  });
});
