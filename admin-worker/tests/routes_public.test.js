import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)`);
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, platform TEXT, external_id TEXT, url TEXT, embed_url TEXT, title TEXT, thumbnail_url TEXT, duration_seconds INTEGER, status TEXT, added_by INTEGER, added_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM videos');
  await env.ADMIN_DB.prepare(`INSERT INTO videos (platform, external_id, url, status, added_by) VALUES ('youtube','y1','https://y/1','valide',1), ('youtube','y2','https://y/2','pas_valide',1)`).run();
});

describe('GET /api/public/videos (no auth)', () => {
  it('returns only validated videos', async () => {
    const req = new Request('https://x/api/public/videos');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items.length).toBe(1);
    expect(j.items[0].external_id).toBe('y1');
  });

  it('sets Cache-Control with 60s s-maxage', async () => {
    const req = new Request('https://x/api/public/videos');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60');
  });
});
