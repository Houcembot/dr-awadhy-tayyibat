# Analytics Visiteurs + Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side analytics system inside the existing `tayyibat-admin` Worker that tracks page-views (IP, country, page, duration) and chatbot question counts, surfacing them in a new "Analytics" tab inside `/admin.html`.

**Architecture:** Extend `tayyibat-admin` with a no-auth `POST /api/track` route (called from `analytics.js` on every page), a secret-protected `POST /api/track-chat` route (called by `tayyibat-chat` via `ctx.waitUntil`), and an admin-only `GET /api/analytics` route returning aggregated stats + 200 recent visits. Cron job purges rows older than 30 days. Data lives in a new D1 table `page_views`.

**Tech Stack:** Cloudflare Workers + D1 (existing `tayyibat-admin-db`), KV (existing `RATE_LIMIT_KV`), Vitest + Miniflare for tests, vanilla JS frontend (sendBeacon).

---

## Reference

**Spec:** `docs/superpowers/specs/2026-06-10-analytics-design.md` — read fully before starting.
**Working directory:** `/home/max/.botfleet/shared/projets/DrDia/repo`
**Branch:** `feature/admin-videos` (existing — keep working on it; merge to main once Analytics is also done).
**D1 DB id:** `8231a7d9-45b9-45f5-a954-3c1cd3a8d424`
**Admin Worker URL:** `https://tayyibat-admin.houcemben.workers.dev`

---

## File Structure

```
admin-worker/
├── migrations/
│   └── 0004_page_views.sql           NEW
├── src/
│   ├── bot_filter.js                 NEW — regex blacklist on user-agent
│   ├── routes/
│   │   ├── track.js                  NEW — POST /api/track + /api/track-chat
│   │   └── analytics.js              NEW — GET /api/analytics admin only
│   └── index.js                      MODIFY — wire routes + add scheduled() handler
├── tests/
│   ├── bot_filter.test.js            NEW
│   ├── routes_track.test.js          NEW
│   └── routes_analytics.test.js      NEW
└── wrangler.toml                     MODIFY — [triggers] crons = ["0 3 * * *"]

chat-worker/
├── src/index.js                      MODIFY — ctx.waitUntil(fetch /api/track-chat)
└── wrangler.toml                     MODIFY — vars.ADMIN_TRACK_URL

analytics.js                          NEW (repo root, served by Pages)
index.html                            MODIFY — <script src="/analytics.js"></script>
videos.html                           MODIFY — same
temoignages.html                      MODIFY — same
chat.html                             MODIFY — same
admin.html                            MODIFY — 4th nav tab + analytics-view + JS
```

---

## Task 1: D1 migration `page_views`

**Files:**
- Create: `admin-worker/migrations/0004_page_views.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT NOT NULL,
  country TEXT,
  page_path TEXT NOT NULL,
  lang TEXT,
  referer TEXT,
  user_agent TEXT,
  duration_ms INTEGER,
  is_chatbot_question INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pv_ts ON page_views(ts DESC);
CREATE INDEX idx_pv_ip ON page_views(ip);
CREATE INDEX idx_pv_country ON page_views(country);
CREATE INDEX idx_pv_chatbot ON page_views(is_chatbot_question) WHERE is_chatbot_question = 1;
```

- [ ] **Step 2: Apply locally**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/admin-worker
npx wrangler d1 execute tayyibat-admin-db --local --file=migrations/0004_page_views.sql
```

Expected: success line.

- [ ] **Step 3: Apply remotely**

```bash
npx wrangler d1 execute tayyibat-admin-db --remote --file=migrations/0004_page_views.sql
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add admin-worker/migrations/0004_page_views.sql
git commit -m "feat(admin-worker): D1 migration 0004 — page_views"
```

---

## Task 2: `TRACKING_KEY` secret on both workers

**Files:** none (operational)

- [ ] **Step 1: Generate the key**

```bash
TRACKING_KEY=$(openssl rand -hex 32)
echo "Save this somewhere safe: $TRACKING_KEY"
```

- [ ] **Step 2: Set on admin-worker**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/admin-worker
echo -n "$TRACKING_KEY" | npx wrangler secret put TRACKING_KEY
```

Expected: `✨ Success! Uploaded secret TRACKING_KEY`.

- [ ] **Step 3: Set on chat-worker**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/chat-worker
echo -n "$TRACKING_KEY" | npx wrangler secret put TRACKING_KEY
```

Expected: same.

- [ ] **Step 4: Append to `.dev.vars` on both workers**

```bash
echo "TRACKING_KEY=$TRACKING_KEY" >> /home/max/.botfleet/shared/projets/DrDia/repo/admin-worker/.dev.vars
echo "TRACKING_KEY=$TRACKING_KEY" >> /home/max/.botfleet/shared/projets/DrDia/repo/chat-worker/.dev.vars
```

No commit (`.dev.vars` is gitignored).

---

## Task 3: Bot filter utility

**Files:**
- Create: `admin-worker/src/bot_filter.js`
- Create: `admin-worker/tests/bot_filter.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import { isBot } from '../src/bot_filter.js';

describe('isBot', () => {
  it('returns false for a real Chrome UA', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe(false);
  });
  it('returns false for null/empty', () => {
    expect(isBot(null)).toBe(false);
    expect(isBot('')).toBe(false);
  });
  it('returns true for Googlebot', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });
  it('returns true for Bingbot', () => {
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
  });
  it('returns true for AhrefsBot, SemrushBot, MJ12bot, DotBot, PetalBot, Bytespider, GPTBot, ClaudeBot', () => {
    for (const name of ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'Bytespider', 'GPTBot', 'ClaudeBot']) {
      expect(isBot(`Mozilla/5.0 (compatible; ${name}/1.0)`)).toBe(true);
    }
  });
  it('is case-insensitive', () => {
    expect(isBot('Mozilla/5.0 GOOGLEBOT/2.1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd admin-worker && npx vitest run tests/bot_filter.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `admin-worker/src/bot_filter.js`**

```js
const BOT_RE = /(googlebot|bingbot|ahrefsbot|semrushbot|mj12bot|duckduckbot|yandexbot|dotbot|petalbot|bytespider|gptbot|claudebot)/i;

export function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_RE.test(userAgent);
}
```

- [ ] **Step 4: Run — pass**

```bash
npx vitest run tests/bot_filter.test.js
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add admin-worker/src/bot_filter.js admin-worker/tests/bot_filter.test.js
git commit -m "feat(admin-worker): bot filter regex on user-agent"
```

---

## Task 4: `POST /api/track` route + tests

**Files:**
- Create: `admin-worker/src/routes/track.js`
- Create: `admin-worker/tests/routes_track.test.js`
- Modify: `admin-worker/src/index.js`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Update `admin-worker/vitest.config.js` to add `TRACKING_KEY` binding**

Open `admin-worker/vitest.config.js`. In the `miniflare.bindings` object, ensure:

```js
bindings: {
  JWT_SECRET: 'test-secret-32-bytes-fixed-string',
  TRACKING_KEY: 'test-tracking-key',
  ALLOWED_ORIGIN: 'https://tayyibat.pages.dev'
}
```

(If `bindings` already has `JWT_SECRET`, just add the two new keys.)

- [ ] **Step 3: Run — confirm fail**

```bash
npx vitest run tests/routes_track.test.js
```

Expected: all FAIL (routes not wired).

- [ ] **Step 4: Implement `admin-worker/src/routes/track.js`**

```js
import { isBot } from '../bot_filter.js';

const PATH_RE = /^\/[a-zA-Z0-9_/.\-]{0,80}$|^\/$/;
const VALID_LANG = new Set(['fr', 'en', 'ar']);
const MAX_DURATION_MS = 30 * 60 * 1000;
const RATE_LIMIT_PER_MIN = 30;

async function isRateLimited(kv, ip) {
  const key = `track:ip:${ip}`;
  const cur = parseInt((await kv.get(key)) || '0', 10);
  if (cur >= RATE_LIMIT_PER_MIN) return true;
  await kv.put(key, String(cur + 1), { expirationTtl: 60 });
  return false;
}

function parseBody(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export async function handleTrack(request, env) {
  // CORS check
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN;
  if (origin && allowed && origin !== allowed && !origin.startsWith('http://localhost')) {
    return new Response('Forbidden', { status: 403 });
  }

  const body = parseBody(await request.text());
  if (!body || typeof body.path !== 'string') {
    return new Response('Bad request', { status: 400 });
  }
  if (!PATH_RE.test(body.path)) {
    return new Response('Invalid path', { status: 400 });
  }

  const ua = request.headers.get('User-Agent') || null;
  if (isBot(ua)) return new Response(null, { status: 204 });

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (await isRateLimited(env.RATE_LIMIT_KV, ip)) {
    return new Response(null, { status: 204 });
  }

  const country = request.headers.get('CF-IPCountry') || null;
  const lang = VALID_LANG.has(body.lang) ? body.lang : null;
  const referer = (typeof body.referer === 'string' && body.referer.startsWith('http')) ? body.referer.slice(0, 500) : null;

  let duration_ms = null;
  if (typeof body.prev_ts === 'number' && body.prev_ts > 0) {
    const d = Date.now() - body.prev_ts;
    if (d > 0 && d <= MAX_DURATION_MS) duration_ms = d;
  }

  const uaTrunc = ua ? ua.slice(0, 200) : null;

  await env.ADMIN_DB.prepare(
    `INSERT INTO page_views (ip, country, page_path, lang, referer, user_agent, duration_ms, is_chatbot_question)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(ip, country, body.path, lang, referer, uaTrunc, duration_ms).run();

  return new Response(null, { status: 204 });
}

export async function handleTrackChat(request, env) {
  const key = request.headers.get('X-Tracking-Key');
  if (!key || !env.TRACKING_KEY || key !== env.TRACKING_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = parseBody(await request.text());
  if (!body) return new Response('Bad request', { status: 400 });

  const ip = String(body.ip || '0.0.0.0').slice(0, 64);
  const country = body.country ? String(body.country).slice(0, 8) : null;
  const lang = VALID_LANG.has(body.lang) ? body.lang : null;
  const ua = body.user_agent ? String(body.user_agent).slice(0, 200) : null;

  await env.ADMIN_DB.prepare(
    `INSERT INTO page_views (ip, country, page_path, lang, user_agent, is_chatbot_question)
     VALUES (?, ?, '/chat/question', ?, ?, 1)`
  ).bind(ip, country, lang, ua).run();

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 5: Wire into `admin-worker/src/index.js`**

Add at top of imports:

```js
import { handleTrack, handleTrackChat } from './routes/track.js';
```

Inside the `try` block of `fetch`, BEFORE the existing `if (request.method === 'GET' && url.pathname === '/api/public/videos')` branch, add:

```js
if (request.method === 'POST' && url.pathname === '/api/track') {
  response = await handleTrack(request, env);
} else if (request.method === 'POST' && url.pathname === '/api/track-chat') {
  response = await handleTrackChat(request, env);
} else
```

(So the new conditions chain BEFORE the existing public videos one.)

- [ ] **Step 6: Run — pass**

```bash
npx vitest run tests/routes_track.test.js
```

Expected: 10 passed.

- [ ] **Step 7: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add admin-worker/src/routes/track.js admin-worker/src/index.js admin-worker/tests/routes_track.test.js admin-worker/vitest.config.js
git commit -m "feat(admin-worker): POST /api/track + /api/track-chat avec rate-limit et bot filter"
```

---

## Task 5: `GET /api/analytics` route + tests

**Files:**
- Create: `admin-worker/src/routes/analytics.js`
- Create: `admin-worker/tests/routes_analytics.test.js`
- Modify: `admin-worker/src/index.js`

- [ ] **Step 1: Write failing tests**

```js
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
  // Seed: 5 page views (3 TN, 2 SA), 2 chatbot questions
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
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/routes_analytics.test.js
```

Expected: FAIL (route not wired).

- [ ] **Step 3: Implement `admin-worker/src/routes/analytics.js`**

```js
import { requireAuth } from '../auth.js';

export async function getAnalytics(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;

  const summaryRow = await env.ADMIN_DB.prepare(
    `SELECT
       SUM(CASE WHEN is_chatbot_question = 0 THEN 1 ELSE 0 END) AS total_views_30d,
       COUNT(DISTINCT ip) AS unique_ips,
       AVG(CASE WHEN is_chatbot_question = 0 THEN duration_ms END) AS avg_duration_ms,
       SUM(CASE WHEN is_chatbot_question = 1 THEN 1 ELSE 0 END) AS chatbot_questions_30d
     FROM page_views
     WHERE ts >= datetime('now', '-30 days')`
  ).first();

  const topCountries = await env.ADMIN_DB.prepare(
    `SELECT country, COUNT(*) AS n FROM page_views
     WHERE ts >= datetime('now', '-30 days') AND country IS NOT NULL
     GROUP BY country ORDER BY n DESC LIMIT 10`
  ).all();

  const topPages = await env.ADMIN_DB.prepare(
    `SELECT page_path, COUNT(*) AS n FROM page_views
     WHERE ts >= datetime('now', '-30 days') AND is_chatbot_question = 0
     GROUP BY page_path ORDER BY n DESC LIMIT 10`
  ).all();

  const recent = await env.ADMIN_DB.prepare(
    `SELECT id, ts, ip, country, page_path, lang, duration_ms, is_chatbot_question,
       substr(user_agent, 1, 80) AS ua
     FROM page_views ORDER BY id DESC LIMIT 200`
  ).all();

  return new Response(JSON.stringify({
    summary: {
      total_views_30d: summaryRow.total_views_30d || 0,
      unique_ips: summaryRow.unique_ips || 0,
      avg_duration_ms: Math.round(summaryRow.avg_duration_ms || 0),
      chatbot_questions_30d: summaryRow.chatbot_questions_30d || 0
    },
    top_countries: topCountries.results,
    top_pages: topPages.results,
    recent: recent.results
  }), { headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Wire into `admin-worker/src/index.js`**

Add to imports:

```js
import { getAnalytics } from './routes/analytics.js';
```

Inside `fetch` try block, before the final `else { response = new Response('Not found', { status: 404 }); }`, add:

```js
} else if (request.method === 'GET' && url.pathname === '/api/analytics') {
  response = await getAnalytics(request, env);
```

- [ ] **Step 5: Run — pass**

```bash
npx vitest run tests/routes_analytics.test.js
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add admin-worker/src/routes/analytics.js admin-worker/src/index.js admin-worker/tests/routes_analytics.test.js
git commit -m "feat(admin-worker): GET /api/analytics admin-only avec agrégations 30j"
```

---

## Task 6: Scheduled cron purge 30j

**Files:**
- Modify: `admin-worker/src/index.js`
- Modify: `admin-worker/wrangler.toml`
- Create: `admin-worker/tests/scheduled.test.js`

- [ ] **Step 1: Add cron config to `admin-worker/wrangler.toml`**

Append at the end of the file:

```toml
[triggers]
crons = ["0 3 * * *"]
```

- [ ] **Step 2: Write failing test**

```js
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
```

- [ ] **Step 3: Run — fail**

```bash
npx vitest run tests/scheduled.test.js
```

Expected: FAIL (no `scheduled` export on worker).

- [ ] **Step 4: Add `scheduled` handler to `admin-worker/src/index.js`**

At the end of the `export default { ... }` object (after `fetch`), add `scheduled`:

```js
export default {
  async fetch(request, env, ctx) {
    // ... existing code ...
  },

  async scheduled(event, env, ctx) {
    const r = await env.ADMIN_DB.prepare(
      "DELETE FROM page_views WHERE ts < datetime('now', '-30 days')"
    ).run();
    console.log(`purge_30d removed=${r.meta.changes}`);
  }
};
```

(Replace the existing single-`fetch` export with the two-method export.)

- [ ] **Step 5: Run — pass**

```bash
npx vitest run tests/scheduled.test.js
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add admin-worker/src/index.js admin-worker/wrangler.toml admin-worker/tests/scheduled.test.js
git commit -m "feat(admin-worker): cron purge 30j sur page_views"
```

---

## Task 7: Deploy admin-worker + full suite

**Files:** none (operational)

- [ ] **Step 1: Run full vitest suite**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/admin-worker
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```

Expected: `Deployed tayyibat-admin triggers (...)` AND `Scheduled triggers (cron: 0 3 * * *)`.

- [ ] **Step 3: Smoke test track route via curl**

```bash
curl -sS -X POST https://tayyibat-admin.houcemben.workers.dev/api/track \
  -H "Content-Type: application/json" \
  -H "Origin: https://tayyibat.pages.dev" \
  -H "User-Agent: Mozilla/5.0 Chrome" \
  -d '{"path":"/test-smoke","lang":"fr"}' \
  -D -
```

Expected: `HTTP/2 204`. Check that there is now a row in remote D1:

```bash
npx wrangler d1 execute tayyibat-admin-db --remote --command="SELECT page_path, ip, country FROM page_views WHERE page_path = '/test-smoke';"
```

Expected: 1 row with path `/test-smoke`.

- [ ] **Step 4: Smoke test analytics (need admin cookie)**

```bash
PW=$(grep '^INITIAL_ADMIN_PASSWORD=' admin-worker/.dev.vars | cut -d= -f2-)
COOKIE=$(curl -sS -X POST https://tayyibat-admin.houcemben.workers.dev/api/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"houcemben@gmail.com\",\"password\":\"$PW\"}" \
  -D - -o /dev/null | grep -i 'set-cookie' | sed 's/[Ss]et-[Cc]ookie: //; s/;.*//')
curl -sS "https://tayyibat-admin.houcemben.workers.dev/api/analytics" \
  -H "Cookie: $COOKIE" -H "X-Requested-With: fetch" | head -c 500
```

Expected: JSON starting with `{"summary":{"total_views_30d":1,...`.

- [ ] **Step 5: Clean up the smoke-test row**

```bash
npx wrangler d1 execute tayyibat-admin-db --remote --command="DELETE FROM page_views WHERE page_path = '/test-smoke';"
```

---

## Task 8: chat-worker fires `waitUntil(track-chat)`

**Files:**
- Modify: `chat-worker/wrangler.toml`
- Modify: `chat-worker/src/index.js`

- [ ] **Step 1: Add `ADMIN_TRACK_URL` var to `chat-worker/wrangler.toml`**

In the `[vars]` block (or add a new one if absent):

```toml
[vars]
ADMIN_TRACK_URL = "https://tayyibat-admin.houcemben.workers.dev/api/track-chat"
```

- [ ] **Step 2: Find the success path in `chat-worker/src/index.js`**

Look for where `/api/chat_v2` returns a successful JSON response (search for `return new Response(JSON.stringify` or similar). Just before the `return`, insert:

```js
if (env.TRACKING_KEY && env.ADMIN_TRACK_URL) {
  ctx.waitUntil(
    fetch(env.ADMIN_TRACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tracking-Key': env.TRACKING_KEY
      },
      body: JSON.stringify({
        ip: request.headers.get('CF-Connecting-IP'),
        country: request.headers.get('CF-IPCountry'),
        lang: typeof body !== 'undefined' && body && body.lang ? body.lang : null,
        user_agent: (request.headers.get('User-Agent') || '').slice(0, 200)
      })
    }).catch(() => {})
  );
}
```

(Adapt the `body.lang` reference: if the variable holding the parsed JSON request body is named differently in `chat-worker/src/index.js`, use that name.)

- [ ] **Step 3: Deploy**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/chat-worker
npx wrangler deploy
```

Expected: `Deployed tayyibat-chat triggers ...`.

- [ ] **Step 4: Smoke test — ask one question and check it lands in page_views**

```bash
curl -sS -X POST https://tayyibat-chat.houcemben.workers.dev/api/chat_v2 \
  -H "Content-Type: application/json" \
  -d '{"question":"هل البطاطس مسموحة؟"}' -o /dev/null
sleep 3
cd ../admin-worker
npx wrangler d1 execute tayyibat-admin-db --remote --command="SELECT page_path, ip, country FROM page_views WHERE is_chatbot_question = 1 ORDER BY id DESC LIMIT 1;"
```

Expected: 1 row with `page_path = '/chat/question'` and a real IP.

- [ ] **Step 5: Commit**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git add chat-worker/src/index.js chat-worker/wrangler.toml
git commit -m "feat(chat-worker): waitUntil ping /api/track-chat sur chaque question"
```

---

## Task 9: Client tracker `analytics.js`

**Files:**
- Create: `analytics.js` (at repo root)

- [ ] **Step 1: Create `/home/max/.botfleet/shared/projets/DrDia/repo/analytics.js`**

```js
(function() {
  var API = 'https://tayyibat-admin.houcemben.workers.dev/api/track';
  var KEY = 'tayyibat:nav';

  var prev = null;
  try {
    var raw = sessionStorage.getItem(KEY);
    if (raw) prev = JSON.parse(raw);
  } catch (e) {}

  var now = Date.now();
  var cur = { path: location.pathname || '/', ts: now };
  try { sessionStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {}

  var body = JSON.stringify({
    path: cur.path,
    lang: document.documentElement.lang || (window.localStorage && localStorage.getItem('lang')) || 'fr',
    referer: document.referrer || null,
    prev_path: prev && prev.path ? prev.path : null,
    prev_ts: prev && prev.ts ? prev.ts : null
  });

  try {
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(API, blob);
    } else {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) {}
})();
```

No commit yet — pair with HTML inclusion in next task.

---

## Task 10: Include `<script src="/analytics.js">` in 4 public pages

**Files:**
- Modify: `index.html`
- Modify: `videos.html`
- Modify: `temoignages.html`
- Modify: `chat.html`

- [ ] **Step 1: Add to `index.html`**

Find the closing `</body>` tag and insert just before it:

```html
<script src="/analytics.js" defer></script>
```

- [ ] **Step 2: Same for `videos.html`**

Find `</body>` and insert just before it:

```html
<script src="/analytics.js" defer></script>
```

- [ ] **Step 3: Same for `temoignages.html`**

```html
<script src="/analytics.js" defer></script>
```

- [ ] **Step 4: Same for `chat.html`**

```html
<script src="/analytics.js" defer></script>
```

- [ ] **Step 5: Deploy Pages**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
ARCHIVE_TARGET=$(readlink archive) && rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s "$ARCHIVE_TARGET" archive
```

Expected: `Deployment complete!`.

- [ ] **Step 6: Smoke test — load `/` in a browser, check D1 for a new row**

```bash
# Visit https://tayyibat.pages.dev/ in browser, then:
npx wrangler d1 execute tayyibat-admin-db --remote --command="SELECT ts, ip, country, page_path FROM page_views ORDER BY id DESC LIMIT 5;"
```

Expected: a recent row for `/`.

- [ ] **Step 7: Commit**

```bash
git add analytics.js index.html videos.html temoignages.html chat.html
git commit -m "feat(client): analytics.js + inclusion sur 4 pages publiques"
```

---

## Task 11: Admin "Analytics" tab — UI + API client

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add the new nav button**

Find the `<nav id="nav" class="hidden">` block. Inside, after the existing 3 view buttons (`videos`, `whitelist`, `users`), add a 4th button:

Locate:

```html
<button data-view="users" id="nav-users">Utilisateurs</button>
```

Add after it (still inside the `<nav>`):

```html
<button data-view="analytics" id="nav-analytics">Analytics</button>
```

- [ ] **Step 2: Add the analytics view container**

In `<main>`, after `<div id="users-view" class="hidden"></div>`, add:

```html
<div id="analytics-view" class="hidden"></div>
```

- [ ] **Step 3: Update `showApp(user)` to hide nav-analytics for non-admin**

Find the line `document.getElementById('nav-users').style.display = user.role === 'admin' ? '' : 'none';`. Add right after it:

```js
document.getElementById('nav-analytics').style.display = user.role === 'admin' ? '' : 'none';
```

- [ ] **Step 4: Update `showView(name)` to switch + load Analytics**

Find the `showView` function. Replace the `for (const v of ['videos', 'whitelist', 'users']) {` loop with:

```js
for (const v of ['videos', 'whitelist', 'users', 'analytics']) {
```

And below the existing `else if (name === 'users') loadUsers();` add:

```js
else if (name === 'analytics') loadAnalytics();
```

- [ ] **Step 5: Add the `loadAnalytics` + `renderAnalytics` logic**

Inside the `<script type="module">` block, after the users-view section, add:

```js
// --- Analytics view ---
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '🌐';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + cc.toUpperCase().charCodeAt(0) - 65)
       + String.fromCodePoint(A + cc.toUpperCase().charCodeAt(1) - 65);
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + 'm' + (r < 10 ? '0' + r : r);
}

let analyticsState = { data: null, recentPage: 1, perPage: 50, filter: '' };

async function loadAnalytics() {
  const v = document.getElementById('analytics-view');
  v.innerHTML = '<p style="color:var(--text-muted)">Chargement…</p>';
  const data = await api('GET', '/api/analytics');
  analyticsState.data = data;
  renderAnalytics();
}

function renderAnalytics() {
  const v = document.getElementById('analytics-view');
  const d = analyticsState.data;
  if (!d) return;
  const s = d.summary;
  const topCountry = d.top_countries[0];

  const filter = analyticsState.filter.toLowerCase();
  const filtered = filter
    ? d.recent.filter(r =>
        (r.ip || '').includes(filter)
        || (r.country || '').toLowerCase().includes(filter)
        || (r.page_path || '').toLowerCase().includes(filter))
    : d.recent;
  const totalPages = Math.max(1, Math.ceil(filtered.length / analyticsState.perPage));
  if (analyticsState.recentPage > totalPages) analyticsState.recentPage = 1;
  const start = (analyticsState.recentPage - 1) * analyticsState.perPage;
  const pageRows = filtered.slice(start, start + analyticsState.perPage);

  v.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <h2 style="font-family:Cairo,serif; margin:0;">Analytics (30 derniers jours)</h2>
      <button class="subtle" id="refresh-analytics">🔄 Rafraîchir</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:32px;">
      ${[
        ['Visiteurs uniques', s.unique_ips],
        ['Visites totales', s.total_views_30d],
        ['Questions chatbot', s.chatbot_questions_30d],
        ['Durée moyenne / page', fmtDuration(s.avg_duration_ms)],
        ['Pays #1', topCountry ? (flagEmoji(topCountry.country) + ' ' + topCountry.country) : '—']
      ].map(([label, val]) => `
        <div style="background:white; padding:18px; border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:var(--text-muted)">${label}</div>
          <div style="font-size:1.6rem; font-weight:700; margin-top:4px; color:var(--dark)">${val}</div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:24px; margin-bottom:32px;">
      <div>
        <h3 style="font-family:Cairo,serif; font-size:14px; text-transform:uppercase; letter-spacing:0.12em; color:var(--text-muted)">Top 10 pays</h3>
        <ul style="list-style:none; padding:0; margin:0;">
          ${d.top_countries.map(c => `
            <li style="padding:8px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
              <span>${flagEmoji(c.country)} ${c.country}</span>
              <strong>${c.n}</strong>
            </li>
          `).join('') || '<li style="color:var(--text-muted)">Aucune donnée</li>'}
        </ul>
      </div>
      <div>
        <h3 style="font-family:Cairo,serif; font-size:14px; text-transform:uppercase; letter-spacing:0.12em; color:var(--text-muted)">Top 10 pages</h3>
        <ul style="list-style:none; padding:0; margin:0;">
          ${d.top_pages.map(p => `
            <li style="padding:8px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
              <code style="font-size:12px;">${p.page_path}</code>
              <strong>${p.n}</strong>
            </li>
          `).join('') || '<li style="color:var(--text-muted)">Aucune donnée</li>'}
        </ul>
      </div>
    </div>

    <h3 style="font-family:Cairo,serif; margin-bottom:8px;">Dernières visites</h3>
    <input type="text" id="recent-filter" placeholder="Filtrer par IP, pays ou page…" value="${filter}" style="margin-bottom:12px;">
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Temps</th><th>IP</th><th>Pays</th><th>Page</th><th>Durée</th><th>Lang</th><th>Chat?</th></tr></thead>
      <tbody>
        ${pageRows.map(r => `
          <tr>
            <td style="font-size:12px;">${(r.ts || '').replace('T', ' ').substring(0, 19)}</td>
            <td style="font-family:monospace; font-size:12px;">${r.ip}</td>
            <td>${r.country ? (flagEmoji(r.country) + ' ' + r.country) : '—'}</td>
            <td><code style="font-size:12px;">${r.page_path}</code></td>
            <td style="font-size:12px;">${fmtDuration(r.duration_ms)}</td>
            <td style="font-size:12px;">${r.lang || '—'}</td>
            <td style="font-size:12px;">${r.is_chatbot_question ? '💬' : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>
    <div style="margin-top:12px; text-align:center;">
      Page ${analyticsState.recentPage}/${totalPages}
      <button class="subtle" id="ana-prev" ${analyticsState.recentPage <= 1 ? 'disabled' : ''}>‹</button>
      <button class="subtle" id="ana-next" ${analyticsState.recentPage >= totalPages ? 'disabled' : ''}>›</button>
    </div>
  `;

  document.getElementById('refresh-analytics').addEventListener('click', loadAnalytics);
  let filterTimer;
  document.getElementById('recent-filter').addEventListener('input', e => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      analyticsState.filter = e.target.value;
      analyticsState.recentPage = 1;
      renderAnalytics();
    }, 200);
  });
  document.getElementById('ana-prev').addEventListener('click', () => { analyticsState.recentPage--; renderAnalytics(); });
  document.getElementById('ana-next').addEventListener('click', () => { analyticsState.recentPage++; renderAnalytics(); });
}
```

- [ ] **Step 6: Deploy Pages**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
ARCHIVE_TARGET=$(readlink archive) && rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s "$ARCHIVE_TARGET" archive
```

- [ ] **Step 7: Manual smoke**

Open `https://tayyibat.pages.dev/admin.html`, login as admin, click "Analytics" tab. Verify 5 stat cards, top countries, top pages, recent visits table. Filter by `TN` should narrow the recent list.

- [ ] **Step 8: Commit**

```bash
git add admin.html
git commit -m "feat(admin): vue Analytics avec cards stats + tops + recent visits"
```

---

## Task 12: E2E smoke test + branch push

**Files:** none (operational)

- [ ] **Step 1: Open clean browser, log in as admin on `/admin.html`**

Verify: 4 tabs visible (Vidéos témoignages, Whitelist, Utilisateurs, Analytics).

- [ ] **Step 2: Navigate the public site to generate views**

Open new tab in incognito, visit:
1. `https://tayyibat.pages.dev/` — stay 10s
2. `https://tayyibat.pages.dev/videos` — stay 5s
3. `https://tayyibat.pages.dev/temoignages` — stay 3s
4. `https://tayyibat.pages.dev/chat` — submit one question (FR/EN/AR doesn't matter)

- [ ] **Step 3: Back in admin, click Analytics → Refresh**

Expected:
- `Visites totales` increased by at least 3
- `Questions chatbot` increased by 1
- Recent visits table shows 4 fresh rows with your IP, country code, correct page_path
- One row has `Chat?` = 💬

- [ ] **Step 4: Verify verificateur cannot see Analytics tab**

Login as a verificateur user; the `Analytics` button must be hidden, and `GET /api/analytics` from devtools must return 403.

- [ ] **Step 5: Push branch to GitHub**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
git push origin feature/admin-videos
```

Expected: push succeeds.

- [ ] **Step 6: Document the smoke**

```bash
git commit --allow-empty -m "chore: E2E smoke test analytics passed — admin/verificateur workflow validated"
git push origin feature/admin-videos
```

---

## Out-of-scope reminders (Phase 2)

See spec section 13. Notably:
- Sessions multi-IP (mobile+desktop dédoublonnés)
- Export CSV des visites
- Filtre temporel custom (7j / 14j / 90j)
- Bandeau cookie/consent RGPD
- Géolocalisation région/ville (pas seulement country)
- Détection bot par fingerprint comportemental

---

## Self-Review Notes

1. **Spec coverage** — every section of the spec maps to at least one task:
   - § 3 architecture → tasks 4, 5, 6, 8, 9, 11
   - § 4 D1 schema → task 1
   - § 5 security (CORS, rate-limit, bot filter, prepared SQL) → tasks 3, 4
   - § 6 client tracker → task 9
   - § 7 admin view → task 11
   - § 8 chat-worker waitUntil → task 8
   - § 9 cron purge → task 6
   - § 11 tests → tasks 3, 4, 5, 6 (vitest) + task 12 (E2E)
   - § 12 deployment → tasks 1, 2, 7, 8, 10, 11

2. **Placeholders** — none. Each step contains exact commands and complete code.

3. **Type consistency** — `page_views`, `is_chatbot_question`, `page_path`, `duration_ms` used uniformly across all tasks. `TRACKING_KEY` set in Task 2, consumed in Tasks 4 and 8. `ADMIN_TRACK_URL` declared in Task 8 wrangler.toml, referenced in chat-worker code. `flagEmoji`/`fmtDuration` helpers defined only once (Task 11).
