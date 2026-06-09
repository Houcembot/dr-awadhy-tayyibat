#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const htmlPath = join(repoRoot, 'temoignages.html');

const html = readFileSync(htmlPath, 'utf8');
const m = html.match(/const\s+VIDEOS\s*=\s*(\[[\s\S]*?\]);/);
if (!m) {
  console.error('Could not find const VIDEOS in temoignages.html');
  process.exit(1);
}
const videos = JSON.parse(m[1]);
console.log(`Found ${videos.length} videos in temoignages.html`);

function parseDur(d) {
  if (!d || typeof d !== 'string') return null;
  const parts = d.split(':').map(n => parseInt(n, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const stmts = videos.map(v => {
  const url = (v.url || '').replace(/'/g, "''");
  const title = (v.title || '').replace(/'/g, "''");
  const thumb = (v.thumb || '').replace(/'/g, "''");
  const dur = parseDur(v.dur);
  const durSql = dur != null ? dur : 'NULL';
  return `INSERT OR IGNORE INTO videos (platform, external_id, url, embed_url, title, thumbnail_url, duration_seconds, added_by, status) VALUES ('youtube','${v.id}','${url}','https://www.youtube.com/embed/${v.id}','${title}','${thumb}',${durSql},1,'pas_valide');`;
});
stmts.push(`INSERT INTO validation_log (video_id, user_id, action, new_status)
  SELECT v.id, 1, 'added', 'pas_valide' FROM videos v
  WHERE v.platform='youtube' AND v.external_id IN (${videos.map(v => `'${v.id}'`).join(',')})
  AND NOT EXISTS (SELECT 1 FROM validation_log l WHERE l.video_id = v.id AND l.action = 'added');`);

const tmp = '/tmp/seed_testimonials.sql';
writeFileSync(tmp, stmts.join('\n'));
console.log(`Wrote ${stmts.length} statements to ${tmp}. Executing on D1 ${flag}...`);

execSync(`npx wrangler d1 execute tayyibat-admin-db ${flag} --file=${tmp}`, { stdio: 'inherit', cwd: join(__dirname, '..') });
console.log('Done.');
