import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { signJWT } from '../src/auth.js';

async function callAnalytics({ role = 'admin', uid = 1, noAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
  if (!noAuth) {
    const token = await signJWT({ uid, role }, 'test-secret-32-bytes-fixed-string', 60);
    headers['Cookie'] = `Auth=${token}`;
  }
  const req = new Request('https://x/api/analytics', { method: 'GET', headers });
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
  await env.ADMIN_DB.prepare(
    `INSERT INTO page_views (ip, country, page_path, lang, duration_ms, is_chatbot_question) VALUES
     ('1.1.1.1','TN','/','fr',3000,0),
     ('1.1.1.1','TN','/videos','fr',5000,0),
     ('2.2.2.2','TN','/temoignages','ar',null,0),
     ('3.3.3.3','SA','/','ar',1000,0),
     ('3.3.3.3','SA','/videos','ar',2000,0),
     ('4.4.4.4','TN','/chat/question','fr',null,1),
     ('5.5.5.5','EG','/chat/question','ar',null,1)`
  ).run();
});

describe('GET /api/analytics', () => {
  it('returns 401 without auth', async () => {
    const res = await callAnalytics({ noAuth: true });
    expect(res.status).toBe(401);
  });

  it('returns 403 for verificateur', async () => {
    const res = await callAnalytics({ role: 'verificateur' });
    expect(res.status).toBe(403);
  });

  it('returns aggregated stats for admin', async () => {
    const res = await callAnalytics();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.summary.total_views_30d).toBe(5);
    expect(j.summary.unique_ips).toBe(5);
    expect(j.summary.chatbot_questions_30d).toBe(2);
    expect(j.summary.avg_duration_ms).toBeGreaterThan(0);
    expect(j.top_countries[0]).toEqual({ country: 'TN', n: 3 });
    expect(j.top_pages.length).toBeGreaterThan(0);
    expect(j.recent.length).toBe(7);
  });
});
