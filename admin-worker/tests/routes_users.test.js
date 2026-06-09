import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { signJWT } from '../src/auth.js';

async function call(method, path, { body, role = 'admin', uid = 1 } = {}) {
  const token = await signJWT({ uid, role }, 'test-secret-32-bytes-fixed-string', 60);
  const req = new Request(`https://x${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cookie': `Auth=${token}`, 'X-Requested-With': 'fetch' },
    body: body ? JSON.stringify(body) : undefined
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, display_name TEXT, password_hash TEXT, password_salt TEXT, role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, last_login_at TEXT)`);
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, platform TEXT, external_id TEXT, url TEXT, added_by INTEGER REFERENCES users(id) ON DELETE RESTRICT, UNIQUE(platform, external_id))`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM videos');
  await env.ADMIN_DB.exec('DELETE FROM users');
  await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (1, ?, ?, ?, ?, ?)')
    .bind('admin@x', 'Admin', 'h', 's', 'admin').run();
});

describe('GET /api/users (admin only)', () => {
  it('returns list', async () => {
    const res = await call('GET', '/api/users');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items.length).toBe(1);
  });
  it('verificateur gets 403', async () => {
    const res = await call('GET', '/api/users', { role: 'verificateur', uid: 1 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users (admin creates verificateur)', () => {
  it('creates new verificateur', async () => {
    const res = await call('POST', '/api/users', {
      body: { email: 'new@x', display_name: 'New', password: 'abcdefgh', role: 'verificateur' }
    });
    expect(res.status).toBe(201);
    const row = await env.ADMIN_DB.prepare('SELECT * FROM users WHERE email = ?').bind('new@x').first();
    expect(row.role).toBe('verificateur');
    expect(row.password_hash).toBeTruthy();
  });

  it('rejects short password', async () => {
    const res = await call('POST', '/api/users', {
      body: { email: 'new@x', display_name: 'New', password: 'short', role: 'verificateur' }
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate email', async () => {
    await call('POST', '/api/users', { body: { email: 'dup@x', display_name: 'D', password: 'abcdefgh', role: 'verificateur' } });
    const res = await call('POST', '/api/users', { body: { email: 'dup@x', display_name: 'D', password: 'abcdefgh', role: 'verificateur' } });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/users/:id', () => {
  it('deactivates a user', async () => {
    await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (2, ?, ?, ?, ?, ?)')
      .bind('v@x', 'V', 'h', 's', 'verificateur').run();
    const res = await call('PATCH', '/api/users/2', { body: { active: false } });
    expect(res.status).toBe(200);
    const row = await env.ADMIN_DB.prepare('SELECT active FROM users WHERE id = 2').first();
    expect(row.active).toBe(0);
  });
});

describe('DELETE /api/users/:id', () => {
  it('admin cannot delete self', async () => {
    const res = await call('DELETE', '/api/users/1');
    expect(res.status).toBe(400);
  });

  it('admin can delete verificateur with no videos', async () => {
    await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (2, ?, ?, ?, ?, ?)')
      .bind('v@x', 'V', 'h', 's', 'verificateur').run();
    const res = await call('DELETE', '/api/users/2');
    expect(res.status).toBe(204);
  });

  it('cannot delete user with videos (FK restrict)', async () => {
    await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (2, ?, ?, ?, ?, ?)')
      .bind('v@x', 'V', 'h', 's', 'verificateur').run();
    await env.ADMIN_DB.prepare('INSERT INTO videos (id, platform, external_id, url, added_by) VALUES (1, ?, ?, ?, 2)')
      .bind('youtube', 'abc', 'https://y/a').run();
    const res = await call('DELETE', '/api/users/2');
    expect(res.status).toBe(409);
  });
});
