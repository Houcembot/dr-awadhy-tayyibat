import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

async function callTrack(body, { ua = 'Mozilla/5.0 Chrome', origin = 'https://tayyibat.pages.dev', ip = '41.225.183.42', country = 'TN' } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': ua,
    'CF-Connecting-IP': ip,
    'CF-IPCountry': country,
    'Origin': origin
  };
  const req = new Request('https://x/api/track', { method: 'POST', headers, body: JSON.stringify(body) });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ip TEXT NOT NULL, country TEXT, page_path TEXT NOT NULL, lang TEXT, referer TEXT, user_agent TEXT, duration_ms INTEGER, is_chatbot_question INTEGER NOT NULL DEFAULT 0)`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM page_views');
  const keys = await env.RATE_LIMIT_KV.list();
  for (const k of keys.keys) await env.RATE_LIMIT_KV.delete(k.name);
});

describe('POST /api/track', () => {
  it('inserts a row with valid input', async () => {
    const res = await callTrack({ path: '/videos', lang: 'fr', referer: 'https://google.com/' });
    expect(res.status).toBe(204);
    const row = await env.ADMIN_DB.prepare('SELECT * FROM page_views').first();
    expect(row.page_path).toBe('/videos');
    expect(row.ip).toBe('41.225.183.42');
    expect(row.country).toBe('TN');
    expect(row.lang).toBe('fr');
    expect(row.is_chatbot_question).toBe(0);
  });

  it('computes duration_ms from prev_ts', async () => {
    const prev_ts = Date.now() - 5000;
    await callTrack({ path: '/temoignages', lang: 'fr', prev_path: '/videos', prev_ts });
    const row = await env.ADMIN_DB.prepare('SELECT duration_ms FROM page_views').first();
    expect(row.duration_ms).toBeGreaterThanOrEqual(4500);
    expect(row.duration_ms).toBeLessThanOrEqual(6000);
  });

  it('caps duration_ms at 30 minutes', async () => {
    const prev_ts = Date.now() - 60 * 60 * 1000;
    await callTrack({ path: '/', prev_path: '/', prev_ts });
    const row = await env.ADMIN_DB.prepare('SELECT duration_ms FROM page_views').first();
    expect(row.duration_ms).toBeNull();
  });

  it('rejects invalid path', async () => {
    const res = await callTrack({ path: 'https://evil.com/x' });
    expect(res.status).toBe(400);
  });

  it('rejects non-allowlisted Origin', async () => {
    const res = await callTrack({ path: '/' }, { origin: 'https://evil.com' });
    expect(res.status).toBe(403);
  });

  it('skips insert silently for bot UA', async () => {
    const res = await callTrack({ path: '/' }, { ua: 'Mozilla/5.0 Googlebot/2.1' });
    expect(res.status).toBe(204);
    const row = await env.ADMIN_DB.prepare('SELECT * FROM page_views').first();
    expect(row).toBeNull();
  });

  it('rate-limits after 30 per minute per IP', async () => {
    for (let i = 0; i < 30; i++) await callTrack({ path: '/' });
    const res = await callTrack({ path: '/' });
    expect(res.status).toBe(204);
    const { n } = await env.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM page_views').first();
    expect(n).toBe(30);
  });
});

describe('POST /api/track-chat', () => {
  async function callTrackChat(body, key) {
    const req = new Request('https://x/api/track-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tracking-Key': key || '' },
      body: JSON.stringify(body)
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it('returns 401 without X-Tracking-Key', async () => {
    const res = await callTrackChat({ ip: '1.2.3.4', country: 'TN' }, null);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong key', async () => {
    const res = await callTrackChat({ ip: '1.2.3.4', country: 'TN' }, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('inserts a chatbot question row with the correct key', async () => {
    const res = await callTrackChat({ ip: '1.2.3.4', country: 'TN', lang: 'ar' }, 'test-tracking-key');
    expect(res.status).toBe(204);
    const row = await env.ADMIN_DB.prepare('SELECT * FROM page_views').first();
    expect(row.is_chatbot_question).toBe(1);
    expect(row.page_path).toBe('/chat/question');
    expect(row.ip).toBe('1.2.3.4');
    expect(row.country).toBe('TN');
    expect(row.lang).toBe('ar');
  });
});
