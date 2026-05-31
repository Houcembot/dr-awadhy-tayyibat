// scripts/build_food_index.mjs
// BUILD-TIME pre-computation : for each unique anchor (canonical / synonym /
// ingredient / strong_match / related_concept / generic), scan the 817 blocks
// once and record which blocks contain that anchor as a word.
//
// The result is a static lookup table the worker imports at startup —
// runtime retrieval becomes O(1) per concept (no full scan).
//
// Run: cd chat-worker && npx vite-node scripts/build_food_index.mjs
// Output: src/food_inverted_index.json

import { textHasAnchor, normalizeArabic } from '../src/query_understanding.js';
import dictionary from '../src/dialect_food_dictionary.json' with { type: 'json' };
import knowledgeRaw from '../src/knowledge_index.json' with { type: 'json' };
import fs from 'node:fs';

// Same GENERIC_SYNONYMS list as scoreBlockV3 in retrieval_v2.js — keep in sync.
const GENERIC_SYNONYMS = ['سكر','سكري','جلوكوز','هيموجلوبين','hba1c','سكريات'];

// Collect unique anchors from all sources.
const anchorSet = new Set();
for (const [canonical, entry] of Object.entries(dictionary)) {
  anchorSet.add(canonical);
  for (const s of entry.synonyms || [])        anchorSet.add(s);
  for (const i of entry.ingredients || [])     anchorSet.add(i);
  for (const sm of entry.strong_matches || []) anchorSet.add(sm);
  for (const rc of entry.related_concepts || []) anchorSet.add(rc);
}
for (const g of GENERIC_SYNONYMS) anchorSet.add(g);

// Normalize all anchors (so the lookup table keys match what runtime would compute).
const normalizedAnchors = [...anchorSet].map(a => normalizeArabic(a))
  .filter(a => a.length > 0);
// Dedupe normalized
const uniqueAnchors = [...new Set(normalizedAnchors)];

console.log(`Anchors to index: ${uniqueAnchors.length} unique (after normalization)`);
console.log(`Blocks to scan:   ${knowledgeRaw.length}`);

// Build the inverted index: anchor → [block_ids where anchor appears as a word].
const invertedIndex = {};
let totalEdges = 0;

for (const anchor of uniqueAnchors) {
  const matchingBlocks = [];
  for (const block of knowledgeRaw) {
    if (block.domain === 'off_topic') continue;
    if (textHasAnchor(block.raw_quote, anchor)) {
      matchingBlocks.push(block.id);
    }
  }
  if (matchingBlocks.length > 0) {
    invertedIndex[anchor] = matchingBlocks;
    totalEdges += matchingBlocks.length;
  }
}

console.log(`\nAnchors with matches:  ${Object.keys(invertedIndex).length}`);
console.log(`Total anchor→block edges: ${totalEdges}`);
console.log(`Avg blocks per anchor:    ${(totalEdges / Object.keys(invertedIndex).length).toFixed(1)}`);

// Distribution: most/least frequent anchors
const sorted = Object.entries(invertedIndex).sort((a, b) => b[1].length - a[1].length);
console.log(`\nTop 5 most frequent anchors:`);
for (const [a, ids] of sorted.slice(0, 5)) console.log(`  ${a.padEnd(20)} → ${ids.length} blocks`);
console.log(`Top 5 least frequent anchors:`);
for (const [a, ids] of sorted.slice(-5)) console.log(`  ${a.padEnd(20)} → ${ids.length} blocks`);

// Write
const outPath = new URL('../src/food_inverted_index.json', import.meta.url);
fs.writeFileSync(outPath, JSON.stringify(invertedIndex, null, 2));
console.log(`\n✓ Written: src/food_inverted_index.json`);
const fileSizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`  File size: ${fileSizeKB} KB`);
