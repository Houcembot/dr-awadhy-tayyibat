import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { signJWT } from '../src/auth.js';

async function call(method, path, { body, role = 'admin', uid = 1, noAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  if (!noAuth) {
    const token = await signJWT({ uid, role }, 'test-secret-32-bytes-fixed-string', 60);
    headers['Cookie'] = `Auth=${token}`;
  }
  const req = new Request(`https://x${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, display_name TEXT, password_hash TEXT, password_salt TEXT, role TEXT, active INTEGER DEFAULT 1, created_at TEXT, created_by INTEGER, last_login_at TEXT)`);
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, external_id TEXT, url TEXT, embed_url TEXT, title TEXT, thumbnail_url TEXT, duration_seconds INTEGER, status TEXT DEFAULT 'pas_valide', note TEXT, added_by INTEGER, added_at TEXT DEFAULT CURRENT_TIMESTAMP, status_changed_by INTEGER, status_changed_at TEXT, UNIQUE(platform, external_id))`);
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS validation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id INTEGER, user_id INTEGER, action TEXT, previous_status TEXT, new_status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM validation_log');
  await env.ADMIN_DB.exec('DELETE FROM videos');
  await env.ADMIN_DB.exec('DELETE FROM users');
  await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (1, ?, ?, ?, ?, ?)')
    .bind('admin@x', 'Admin', 'h', 's', 'admin').run();
  await env.ADMIN_DB.prepare(
    `INSERT INTO videos (platform, external_id, url, status, added_by) VALUES ('youtube','y1','https://y/1','valide',1), ('youtube','y2','https://y/2','valide',1), ('tiktok','t1','https://t/1','pas_valide',1)`
  ).run();
});

describe('GET /api/videos', () => {
  it('returns all videos for admin', async () => {
    const res = await call('GET', '/api/videos');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items).toHaveLength(3);
    expect(j.total).toBe(3);
  });

  it('filters by status=valide', async () => {
    const res = await call('GET', '/api/videos?status=valide');
    const j = await res.json();
    expect(j.items).toHaveLength(2);
  });

  it('filters by platform=tiktok', async () => {
    const res = await call('GET', '/api/videos?platform=tiktok');
    const j = await res.json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0].platform).toBe('tiktok');
  });

  it('paginates with page + per_page', async () => {
    const res = await call('GET', '/api/videos?page=1&per_page=2');
    const j = await res.json();
    expect(j.items).toHaveLength(2);
    expect(j.total).toBe(3);
  });

  it('returns 401 without auth', async () => {
    const res = await call('GET', '/api/videos', { noAuth: true });
    expect(res.status).toBe(401);
  });
});
