import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

beforeAll(async () => {
  await env.ADMIN_DB.exec(`CREATE TABLE IF NOT EXISTS page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, ip TEXT NOT NULL, country TEXT, page_path TEXT NOT NULL, lang TEXT, referer TEXT, user_agent TEXT, duration_ms INTEGER, is_chatbot_question INTEGER NOT NULL DEFAULT 0)`);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM page_views');
});

describe('scheduled purge', () => {
  it('deletes rows older than 30 days but keeps recent ones', async () => {
    await env.ADMIN_DB.prepare(
      `INSERT INTO page_views (ts, ip, page_path) VALUES
        (datetime('now', '-40 days'), '1.1.1.1', '/'),
        (datetime('now', '-10 days'), '2.2.2.2', '/'),
        (datetime('now'), '3.3.3.3', '/')`
    ).run();

    const ctrl = createScheduledController({ cron: '0 3 * * *' });
    const ctx = createExecutionContext();
    await worker.scheduled(ctrl, env, ctx);
    await waitOnExecutionContext(ctx);

    const { n } = await env.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM page_views').first();
    expect(n).toBe(2);
  });
});
