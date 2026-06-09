#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const ids = JSON.parse(readFileSync(join(repoRoot, 'data/videos-whitelist.json'), 'utf8'));

const BLACKLIST = new Set(['b9zMgqAV-7s']);
const filtered = ids.filter(id => !BLACKLIST.has(id));

console.log(`Loaded ${ids.length} IDs, after blacklist: ${filtered.length}`);

const stmts = filtered.map(id => `INSERT OR IGNORE INTO video_whitelist (external_id, added_by) VALUES ('${id.replace(/'/g, "''")}', 1);`);
const tmp = '/tmp/seed_whitelist.sql';
writeFileSync(tmp, stmts.join('\n'));

const flag = process.argv.includes('--remote') ? '--remote' : '--local';
execSync(`npx wrangler d1 execute tayyibat-admin-db ${flag} --file=${tmp}`, { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('Done.');
