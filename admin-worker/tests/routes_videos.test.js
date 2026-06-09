import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

describe('POST /api/videos', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'Test', thumbnail_url: 'https://i/x.jpg'
    })));
  });

  it('adds a YouTube video with pas_valide status', async () => {
    const res = await call('POST', '/api/videos', {
      body: { url: 'https://www.youtube.com/watch?v=newvid12345' }
    });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.platform).toBe('youtube');
    expect(j.external_id).toBe('newvid12345');
    expect(j.status).toBe('pas_valide');
  });

  it('logs added action in validation_log', async () => {
    await call('POST', '/api/videos', { body: { url: 'https://www.youtube.com/watch?v=newvid12345' } });
    const log = await env.ADMIN_DB.prepare(`SELECT action FROM validation_log`).first();
    expect(log.action).toBe('added');
  });

  it('rejects unsupported platform', async () => {
    const res = await call('POST', '/api/videos', { body: { url: 'https://vimeo.com/123' } });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate (UNIQUE constraint)', async () => {
    await call('POST', '/api/videos', { body: { url: 'https://www.youtube.com/watch?v=dupvid123456' } });
    const res = await call('POST', '/api/videos', { body: { url: 'https://www.youtube.com/watch?v=dupvid123456' } });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/videos/:id', () => {
  it('toggles status pas_valide -> valide and logs validated', async () => {
    const insert = await env.ADMIN_DB.prepare('SELECT id FROM videos WHERE external_id = ?').bind('t1').first();
    const res = await call('PATCH', `/api/videos/${insert.id}`, { body: { status: 'valide', note: 'OK' } });
    expect(res.status).toBe(200);
    const row = await env.ADMIN_DB.prepare('SELECT status, note, status_changed_by FROM videos WHERE id = ?').bind(insert.id).first();
    expect(row.status).toBe('valide');
    expect(row.note).toBe('OK');
    const log = await env.ADMIN_DB.prepare(`SELECT action FROM validation_log WHERE video_id = ? ORDER BY id DESC`).bind(insert.id).first();
    expect(log.action).toBe('validated');
  });

  it('vérificateur can PATCH', async () => {
    await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (2, ?, ?, ?, ?, ?)')
      .bind('v@x', 'V', 'h', 's', 'verificateur').run();
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos WHERE external_id = ?').bind('t1').first();
    const res = await call('PATCH', `/api/videos/${v.id}`, { body: { status: 'valide' }, role: 'verificateur', uid: 2 });
    expect(res.status).toBe(200);
  });

  it('updates note only logs noted action', async () => {
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos WHERE external_id = ?').bind('y1').first();
    await call('PATCH', `/api/videos/${v.id}`, { body: { note: 'Just a note' } });
    const log = await env.ADMIN_DB.prepare(`SELECT action FROM validation_log WHERE video_id = ? ORDER BY id DESC`).bind(v.id).first();
    expect(log.action).toBe('noted');
  });

  it('rejects invalid status', async () => {
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos LIMIT 1').first();
    const res = await call('PATCH', `/api/videos/${v.id}`, { body: { status: 'maybe' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await call('PATCH', '/api/videos/99999', { body: { status: 'valide' } });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/videos/:id', () => {
  it('admin can delete', async () => {
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos LIMIT 1').first();
    const res = await call('DELETE', `/api/videos/${v.id}`);
    expect(res.status).toBe(204);
    const exists = await env.ADMIN_DB.prepare('SELECT id FROM videos WHERE id = ?').bind(v.id).first();
    expect(exists).toBeNull();
  });

  it('vérificateur cannot delete', async () => {
    await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (2, ?, ?, ?, ?, ?)')
      .bind('v@x', 'V', 'h', 's', 'verificateur').run();
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos LIMIT 1').first();
    const res = await call('DELETE', `/api/videos/${v.id}`, { role: 'verificateur', uid: 2 });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/videos/:id', () => {
  it('returns video + log history', async () => {
    const v = await env.ADMIN_DB.prepare('SELECT id FROM videos LIMIT 1').first();
    await env.ADMIN_DB.prepare(
      `INSERT INTO validation_log (video_id, user_id, action) VALUES (?, 1, 'added')`
    ).bind(v.id).run();
    const res = await call('GET', `/api/videos/${v.id}`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.video.id).toBe(v.id);
    expect(j.history.length).toBeGreaterThanOrEqual(1);
  });
});
