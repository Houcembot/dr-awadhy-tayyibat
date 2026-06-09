import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';

async function call(method, path, { body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' };
  const req = new Request(`https://x${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, last_login_at TEXT)`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM users');
  const keys = await env.RATE_LIMIT_KV.list();
  for (const k of keys.keys) await env.RATE_LIMIT_KV.delete(k.name);
  const { hash, salt } = await hashPassword('hunter2');
  await env.ADMIN_DB.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)`
  ).bind('houcemben@gmail.com', 'Houcem', hash, salt, 'admin').run();
});

describe('POST /api/login', () => {
  it('returns 200 + Set-Cookie on valid credentials', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'houcemben@gmail.com', password: 'hunter2' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Auth=');
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
  });

  it('returns 401 on wrong password', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'houcemben@gmail.com', password: 'wrong' } });
    expect(res.status).toBe(401);
  });

  it('returns 401 on unknown email', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'x@y.z', password: 'hunter2' } });
    expect(res.status).toBe(401);
  });

  it('blocks after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/login', { body: { email: 'houcemben@gmail.com', password: 'wrong' } });
    }
    const res = await call('POST', '/api/login', { body: { email: 'houcemben@gmail.com', password: 'hunter2' } });
    expect(res.status).toBe(429);
  });
});

describe('POST /api/logout', () => {
  it('returns 200 + clearing Set-Cookie', async () => {
    const res = await call('POST', '/api/logout');
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
