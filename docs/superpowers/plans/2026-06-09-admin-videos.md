# Admin Vidéos Témoignages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modération system for video testimonials with admin/verificateur login, multi-platform video CRUD (YouTube/Facebook/Instagram/TikTok), 2-status workflow, and audit trail.

**Architecture:** Static admin page on Cloudflare Pages (`admin.html`) calling a new isolated Cloudflare Worker (`tayyibat-admin`) backed by D1 SQLite. JWT in httpOnly cookie. KV for rate-limit. Public testimonials page fetches validated-only videos from a no-auth Worker route.

**Tech Stack:** Cloudflare Workers + D1 + KV, Web Crypto (PBKDF2/HS256, no external libs), Vitest + Miniflare for tests, vanilla JS frontend (no framework).

---

## Reference

**Spec:** `docs/superpowers/specs/2026-06-09-admin-videos-design.md` — read fully before starting.
**Working directory:** `/home/max/.botfleet/shared/projets/DrDia/repo`
**Existing chat-worker** (reference for style/conventions): `chat-worker/src/`

---

## File Structure

```
admin-worker/                   ← NEW Cloudflare Worker (isolated)
├── package.json
├── wrangler.toml               D1 + KV bindings, secrets refs
├── vitest.config.js
├── src/
│   ├── index.js                Router entry, CORS, error wrapper
│   ├── auth.js                 PBKDF2 hash/verify, JWT sign/verify, requireAuth middleware
│   ├── cookie.js               parseCookie / formatCookie helpers
│   ├── rate_limit.js           KV brute-force counters per email / IP
│   ├── db.js                   D1 query helpers (prepared statements)
│   ├── routes/
│   │   ├── login.js
│   │   ├── videos.js
│   │   ├── users.js
│   │   └── public.js
│   └── platforms/
│       ├── index.js            dispatcher (URL → platform module)
│       ├── youtube.js
│       ├── tiktok.js
│       ├── instagram.js
│       └── facebook.js
├── migrations/
│   └── 0001_init.sql           users, videos, validation_log, indexes, seed admin
├── scripts/
│   └── seed_testimonials.mjs   extract 185 videos from temoignages.html → D1
└── tests/
    ├── auth.test.js
    ├── cookie.test.js
    ├── rate_limit.test.js
    ├── platforms.test.js
    ├── routes_login.test.js
    ├── routes_videos.test.js
    ├── routes_users.test.js
    └── routes_public.test.js

admin.html                      ← NEW at repo root (Cloudflare Pages)
temoignages.html                ← MODIFY: replace inline VIDEOS with fetch
```

---

## Task 1: Scaffold admin-worker

**Files:**
- Create: `admin-worker/package.json`
- Create: `admin-worker/wrangler.toml`
- Create: `admin-worker/vitest.config.js`
- Create: `admin-worker/.gitignore`

- [ ] **Step 1: Create directory**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
mkdir -p admin-worker/src/routes admin-worker/src/platforms admin-worker/migrations admin-worker/scripts admin-worker/tests
```

- [ ] **Step 2: Create `admin-worker/package.json`**

```json
{
  "name": "tayyibat-admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "vitest": "^2.0.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

- [ ] **Step 3: Create `admin-worker/wrangler.toml`** (D1 id placeholder filled in Task 2)

```toml
name = "tayyibat-admin"
main = "src/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "ADMIN_DB"
database_name = "tayyibat-admin-db"
database_id = "REPLACE_AFTER_D1_CREATE"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "49981be2901d404b8f052e164b00b4d0"

[vars]
ALLOWED_ORIGIN = "https://tayyibat.pages.dev"
```

- [ ] **Step 4: Create `admin-worker/vitest.config.js`**

```js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['ADMIN_DB'],
          kvNamespaces: ['RATE_LIMIT_KV'],
          bindings: { JWT_SECRET: 'test-secret-32-bytes-fixed-string' }
        }
      }
    }
  }
});
```

- [ ] **Step 5: Create `admin-worker/.gitignore`**

```
node_modules/
.wrangler/
.dev.vars
```

- [ ] **Step 6: Install deps**

```bash
cd admin-worker && npm install
```

- [ ] **Step 7: Commit**

```bash
git add admin-worker/package.json admin-worker/package-lock.json admin-worker/wrangler.toml admin-worker/vitest.config.js admin-worker/.gitignore
git commit -m "feat(admin-worker): scaffold"
```

---

## Task 2: D1 migration — schema + seed admin

**Files:**
- Create: `admin-worker/migrations/0001_init.sql`

- [ ] **Step 1: Create D1 database remote**

```bash
cd admin-worker
npx wrangler d1 create tayyibat-admin-db
```

Expected output includes `database_id = "..."`. Copy it into `wrangler.toml` replacing `REPLACE_AFTER_D1_CREATE`.

- [ ] **Step 2: Write `admin-worker/migrations/0001_init.sql`**

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','verificateur')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_login_at TEXT
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK(platform IN ('youtube','facebook','instagram','tiktok')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  embed_url TEXT,
  title TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'pas_valide' CHECK(status IN ('valide','pas_valide')),
  note TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at TEXT,
  UNIQUE(platform, external_id)
);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_platform ON videos(platform);

CREATE TABLE validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('added','validated','unvalidated','deleted','noted')),
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_log_video ON validation_log(video_id, created_at);
```

- [ ] **Step 3: Apply migration locally**

```bash
npx wrangler d1 execute tayyibat-admin-db --local --file=migrations/0001_init.sql
```

Expected: `🚣 Executed N commands ...`

- [ ] **Step 4: Apply migration remotely**

```bash
npx wrangler d1 execute tayyibat-admin-db --remote --file=migrations/0001_init.sql
```

- [ ] **Step 5: Commit**

```bash
git add admin-worker/wrangler.toml admin-worker/migrations/0001_init.sql
git commit -m "feat(admin-worker): D1 schema migration 0001"
```

---

## Task 3: Secrets setup

**Files:** none (operational task)

- [ ] **Step 1: Generate JWT_SECRET (32 random bytes hex)**

```bash
openssl rand -hex 32
```

Copy the output.

- [ ] **Step 2: Set Worker secret**

```bash
cd admin-worker
echo "<paste-the-hex>" | npx wrangler secret put JWT_SECRET
```

Expected: `✨ Success! Uploaded secret JWT_SECRET`

- [ ] **Step 3: Generate INITIAL_ADMIN_PASSWORD**

```bash
openssl rand -base64 18
```

Copy and **save it somewhere safe** (1Password / Obsidian) — you'll log in with it the first time. The user must change it after first login (not enforced yet in MVP — just policy).

- [ ] **Step 4: Set as secret**

```bash
echo "<paste-the-password>" | npx wrangler secret put INITIAL_ADMIN_PASSWORD
```

- [ ] **Step 5: Create `.dev.vars` for local dev** (gitignored)

```bash
cat > .dev.vars <<EOF
JWT_SECRET=$(openssl rand -hex 32)
INITIAL_ADMIN_PASSWORD=local-dev-only-password
EOF
```

No commit (secrets ignored).

---

## Task 4: PBKDF2 hash/verify utility

**Files:**
- Create: `admin-worker/src/auth.js` (start)
- Create: `admin-worker/tests/auth.test.js`

- [ ] **Step 1: Write failing tests in `admin-worker/tests/auth.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('PBKDF2 hash/verify', () => {
  it('hashes a password into { hash, salt } base64 strings', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(hash).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(salt.length).toBeGreaterThanOrEqual(20);
  });

  it('produces different hashes for same password (different salts)', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('verifyPassword returns true for correct password', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', hash, salt)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const { hash, salt } = await hashPassword('hunter2');
    expect(await verifyPassword('wrong', hash, salt)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm fail**

```bash
cd admin-worker && npx vitest run tests/auth.test.js
```

Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement in `admin-worker/src/auth.js`**

```js
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

function base64ToBuf(b64) {
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

async function pbkdf2(password, saltBuf) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const hashBuf = await pbkdf2(password, salt.buffer);
  return { hash: bufToBase64(hashBuf), salt: bufToBase64(salt.buffer) };
}

export async function verifyPassword(password, expectedHashB64, saltB64) {
  const saltBuf = base64ToBuf(saltB64);
  const actualBuf = await pbkdf2(password, saltBuf);
  const actualB64 = bufToBase64(actualBuf);
  // constant-time compare
  if (actualB64.length !== expectedHashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < actualB64.length; i++) {
    diff |= actualB64.charCodeAt(i) ^ expectedHashB64.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
npx vitest run tests/auth.test.js
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/auth.js admin-worker/tests/auth.test.js
git commit -m "feat(admin-worker): PBKDF2 hash/verify password"
```

---

## Task 5: JWT sign/verify

**Files:**
- Modify: `admin-worker/src/auth.js`
- Modify: `admin-worker/tests/auth.test.js`

- [ ] **Step 1: Append failing tests to `tests/auth.test.js`**

```js
import { signJWT, verifyJWT } from '../src/auth.js';

describe('JWT HS256', () => {
  const secret = 'test-secret-32-bytes-fixed-string';

  it('signs and verifies a valid token', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, 60);
    const payload = await verifyJWT(token, secret);
    expect(payload.uid).toBe(1);
    expect(payload.role).toBe('admin');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects token with wrong secret', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, 60);
    await expect(verifyJWT(token, 'other-secret')).rejects.toThrow(/signature/i);
  });

  it('rejects expired token', async () => {
    const token = await signJWT({ uid: 1, role: 'admin' }, secret, -10);
    await expect(verifyJWT(token, secret)).rejects.toThrow(/expired/i);
  });

  it('rejects malformed token', async () => {
    await expect(verifyJWT('not.a.jwt', secret)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
npx vitest run tests/auth.test.js
```

- [ ] **Step 3: Append to `src/auth.js`**

```js
function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function signJWT(payload, secret, ttlSeconds = 28800) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sig = bufToBase64(sigBuf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${data}.${sig}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sigBuf = base64ToBuf(sig.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((sig.length + 3) % 4));
  const valid = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(data));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(b64urlDecode(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}
```

- [ ] **Step 4: Run — confirm pass**

```bash
npx vitest run tests/auth.test.js
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/auth.js admin-worker/tests/auth.test.js
git commit -m "feat(admin-worker): JWT HS256 sign/verify"
```

---

## Task 6: Cookie helpers

**Files:**
- Create: `admin-worker/src/cookie.js`
- Create: `admin-worker/tests/cookie.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import { parseCookie, formatAuthCookie, clearAuthCookie } from '../src/cookie.js';

describe('cookie helpers', () => {
  it('parses a single cookie header', () => {
    expect(parseCookie('Auth=abc.def.ghi')).toEqual({ Auth: 'abc.def.ghi' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookie('a=1; b=2; Auth=xyz')).toEqual({ a: '1', b: '2', Auth: 'xyz' });
  });

  it('returns {} for null header', () => {
    expect(parseCookie(null)).toEqual({});
  });

  it('formats auth cookie with required flags', () => {
    const c = formatAuthCookie('jwt.value');
    expect(c).toContain('Auth=jwt.value');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=28800');
  });

  it('clearAuthCookie produces Max-Age=0', () => {
    expect(clearAuthCookie()).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/cookie.test.js
```

- [ ] **Step 3: Implement `src/cookie.js`**

```js
export function parseCookie(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function formatAuthCookie(jwt) {
  return `Auth=${jwt}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
}

export function clearAuthCookie() {
  return `Auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
```

- [ ] **Step 4: Run — pass**

```bash
npx vitest run tests/cookie.test.js
```

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/cookie.js admin-worker/tests/cookie.test.js
git commit -m "feat(admin-worker): cookie parse/format helpers"
```

---

## Task 7: Rate-limit KV utility

**Files:**
- Create: `admin-worker/src/rate_limit.js`
- Create: `admin-worker/tests/rate_limit.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { recordLoginFailure, isLoginBlocked, clearLoginFailures } from '../src/rate_limit.js';

describe('rate-limit', () => {
  beforeEach(async () => {
    // wipe KV between tests
    const keys = await env.RATE_LIMIT_KV.list();
    for (const k of keys.keys) await env.RATE_LIMIT_KV.delete(k.name);
  });

  it('starts unblocked', async () => {
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4')).toBe(false);
  });

  it('blocks email after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginFailure(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4');
    }
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '5.6.7.8')).toBe(true);
  });

  it('blocks IP after 20 failures across emails', async () => {
    for (let i = 0; i < 20; i++) {
      await recordLoginFailure(env.RATE_LIMIT_KV, `user${i}@b.c`, '1.2.3.4');
    }
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'fresh@b.c', '1.2.3.4')).toBe(true);
  });

  it('clearLoginFailures resets the email counter', async () => {
    for (let i = 0; i < 5; i++) await recordLoginFailure(env.RATE_LIMIT_KV, 'a@b.c', '1.2.3.4');
    await clearLoginFailures(env.RATE_LIMIT_KV, 'a@b.c');
    expect(await isLoginBlocked(env.RATE_LIMIT_KV, 'a@b.c', '5.6.7.8')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/rate_limit.test.js
```

- [ ] **Step 3: Implement `src/rate_limit.js`**

```js
const EMAIL_THRESHOLD = 5;
const IP_THRESHOLD = 20;
const WINDOW_SECONDS = 15 * 60;     // 15 min counting window
const BLOCK_SECONDS = 30 * 60;      // 30 min block once tripped

const emailKey = (email) => `login:email:${email.toLowerCase()}`;
const ipKey = (ip) => `login:ip:${ip}`;

async function bump(kv, key, threshold) {
  const cur = parseInt(await kv.get(key) || '0', 10);
  const next = cur + 1;
  // If already over threshold, extend block; else use window TTL
  const ttl = next >= threshold ? BLOCK_SECONDS : WINDOW_SECONDS;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
}

export async function recordLoginFailure(kv, email, ip) {
  await bump(kv, emailKey(email), EMAIL_THRESHOLD);
  await bump(kv, ipKey(ip), IP_THRESHOLD);
}

export async function isLoginBlocked(kv, email, ip) {
  const e = parseInt(await kv.get(emailKey(email)) || '0', 10);
  if (e >= EMAIL_THRESHOLD) return true;
  const i = parseInt(await kv.get(ipKey(ip)) || '0', 10);
  if (i >= IP_THRESHOLD) return true;
  return false;
}

export async function clearLoginFailures(kv, email) {
  await kv.delete(emailKey(email));
}
```

- [ ] **Step 4: Run — pass**

```bash
npx vitest run tests/rate_limit.test.js
```

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/rate_limit.js admin-worker/tests/rate_limit.test.js
git commit -m "feat(admin-worker): KV-based login rate-limiter"
```

---

## Task 8: `requireAuth` middleware

**Files:**
- Modify: `admin-worker/src/auth.js`
- Modify: `admin-worker/tests/auth.test.js`

- [ ] **Step 1: Append failing tests**

```js
import { requireAuth } from '../src/auth.js';

describe('requireAuth middleware', () => {
  const secret = 'test-secret-32-bytes-fixed-string';

  async function makeReq(cookie) {
    return new Request('https://x/', { headers: cookie ? { Cookie: cookie } : {} });
  }

  it('returns 401 when no cookie', async () => {
    const req = await makeReq(null);
    const result = await requireAuth(req, secret, ['admin', 'verificateur']);
    expect(result.error.status).toBe(401);
  });

  it('returns 401 when invalid JWT', async () => {
    const req = await makeReq('Auth=bad.token.value');
    const result = await requireAuth(req, secret, ['admin', 'verificateur']);
    expect(result.error.status).toBe(401);
  });

  it('returns 403 when role not allowed', async () => {
    const token = await signJWT({ uid: 5, role: 'verificateur' }, secret, 60);
    const req = await makeReq(`Auth=${token}`);
    const result = await requireAuth(req, secret, ['admin']);
    expect(result.error.status).toBe(403);
  });

  it('returns user payload when authorized', async () => {
    const token = await signJWT({ uid: 5, role: 'admin' }, secret, 60);
    const req = await makeReq(`Auth=${token}`);
    const result = await requireAuth(req, secret, ['admin']);
    expect(result.user.uid).toBe(5);
    expect(result.user.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/auth.test.js
```

- [ ] **Step 3: Append to `src/auth.js`**

```js
import { parseCookie } from './cookie.js';

export async function requireAuth(request, secret, allowedRoles) {
  const cookies = parseCookie(request.headers.get('Cookie'));
  const token = cookies.Auth;
  if (!token) {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }
  let payload;
  try {
    payload = await verifyJWT(token, secret);
  } catch {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }
  if (!allowedRoles.includes(payload.role)) {
    return { error: new Response('Forbidden', { status: 403 }) };
  }
  return { user: payload };
}
```

- [ ] **Step 4: Run — pass**

```bash
npx vitest run tests/auth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/auth.js admin-worker/tests/auth.test.js
git commit -m "feat(admin-worker): requireAuth middleware"
```

---

## Task 9: YouTube platform module

**Files:**
- Create: `admin-worker/src/platforms/youtube.js`
- Create: `admin-worker/tests/platforms.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import * as youtube from '../src/platforms/youtube.js';

describe('youtube.parse', () => {
  it('parses youtube.com/watch?v=ID', () => {
    expect(youtube.parse('https://www.youtube.com/watch?v=cZ3GxPO4cXo')).toEqual({
      valid: true, external_id: 'cZ3GxPO4cXo', normalized_url: 'https://www.youtube.com/watch?v=cZ3GxPO4cXo'
    });
  });

  it('parses youtu.be/ID', () => {
    expect(youtube.parse('https://youtu.be/cZ3GxPO4cXo')).toMatchObject({ valid: true, external_id: 'cZ3GxPO4cXo' });
  });

  it('parses youtube.com/shorts/ID', () => {
    expect(youtube.parse('https://www.youtube.com/shorts/cZ3GxPO4cXo')).toMatchObject({ valid: true, external_id: 'cZ3GxPO4cXo' });
  });

  it('rejects non-YouTube URL', () => {
    expect(youtube.parse('https://vimeo.com/123').valid).toBe(false);
  });

  it('rejects non-https schema', () => {
    expect(youtube.parse('http://youtube.com/watch?v=abc').valid).toBe(false);
  });
});

describe('youtube.fetchMetadata', () => {
  it('returns metadata from oEmbed', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'Test Video', thumbnail_url: 'https://i.ytimg.com/x.jpg'
    })));
    const meta = await youtube.fetchMetadata('cZ3GxPO4cXo');
    expect(meta.title).toBe('Test Video');
    expect(meta.thumbnail_url).toBe('https://i.ytimg.com/x.jpg');
    expect(meta.embed_url).toBe('https://www.youtube.com/embed/cZ3GxPO4cXo');
  });

  it('falls back gracefully when oEmbed fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const meta = await youtube.fetchMetadata('badid');
    expect(meta.title).toBe(null);
    expect(meta.embed_url).toBe('https://www.youtube.com/embed/badid');
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/platforms.test.js
```

- [ ] **Step 3: Implement `src/platforms/youtube.js`**

```js
const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  let id = null;
  if (u.hostname === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0];
  } else if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
  }
  if (!id || !ID_RE.test(id)) return { valid: false };
  return {
    valid: true,
    external_id: id,
    normalized_url: `https://www.youtube.com/watch?v=${id}`
  };
}

export async function fetchMetadata(external_id) {
  const embed_url = `https://www.youtube.com/embed/${external_id}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${external_id}&format=json`;
  try {
    const r = await fetch(oembedUrl);
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const data = await r.json();
    return {
      title: data.title || null,
      thumbnail_url: data.thumbnail_url || `https://i.ytimg.com/vi/${external_id}/mqdefault.jpg`,
      duration_seconds: null,
      embed_url
    };
  } catch {
    return {
      title: null,
      thumbnail_url: `https://i.ytimg.com/vi/${external_id}/mqdefault.jpg`,
      duration_seconds: null,
      embed_url
    };
  }
}
```

- [ ] **Step 4: Run — pass**

```bash
npx vitest run tests/platforms.test.js
```

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/platforms/youtube.js admin-worker/tests/platforms.test.js
git commit -m "feat(admin-worker): YouTube platform module"
```

---

## Task 10: TikTok platform module

**Files:**
- Create: `admin-worker/src/platforms/tiktok.js`
- Modify: `admin-worker/tests/platforms.test.js`

- [ ] **Step 1: Append failing tests**

```js
import * as tiktok from '../src/platforms/tiktok.js';

describe('tiktok.parse', () => {
  it('parses tiktok.com/@user/video/ID', () => {
    expect(tiktok.parse('https://www.tiktok.com/@user/video/7012345678901234567')).toMatchObject({
      valid: true, external_id: '7012345678901234567'
    });
  });

  it('parses vm.tiktok.com/SHORTCODE/', () => {
    expect(tiktok.parse('https://vm.tiktok.com/abc123/')).toMatchObject({ valid: true, external_id: 'abc123' });
  });

  it('rejects non-TikTok', () => {
    expect(tiktok.parse('https://youtube.com/watch?v=x').valid).toBe(false);
  });
});

describe('tiktok.fetchMetadata', () => {
  it('returns oEmbed metadata when available', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: 'TikTok video', thumbnail_url: 'https://p.tiktok.com/x.jpg', html: '<blockquote></blockquote>'
    })));
    const meta = await tiktok.fetchMetadata('7012345678901234567', 'https://www.tiktok.com/@u/video/7012345678901234567');
    expect(meta.title).toBe('TikTok video');
    expect(meta.embed_url).toBe('https://www.tiktok.com/@u/video/7012345678901234567');
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/platforms/tiktok.js`**

```js
const ID_RE = /^[A-Za-z0-9]+$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (u.hostname === 'www.tiktok.com' || u.hostname === 'tiktok.com') {
    const m = u.pathname.match(/^\/@[^/]+\/video\/(\d+)/);
    if (m && ID_RE.test(m[1])) {
      return { valid: true, external_id: m[1], normalized_url: u.href };
    }
  }
  if (u.hostname === 'vm.tiktok.com') {
    const code = u.pathname.replace(/\//g, '');
    if (code && ID_RE.test(code)) {
      return { valid: true, external_id: code, normalized_url: u.href };
    }
  }
  return { valid: false };
}

export async function fetchMetadata(external_id, normalized_url) {
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalized_url)}`;
    const r = await fetch(oembedUrl);
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const data = await r.json();
    return {
      title: data.title || null,
      thumbnail_url: data.thumbnail_url || null,
      duration_seconds: null,
      embed_url: normalized_url
    };
  } catch {
    return { title: null, thumbnail_url: null, duration_seconds: null, embed_url: normalized_url };
  }
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/platforms/tiktok.js admin-worker/tests/platforms.test.js
git commit -m "feat(admin-worker): TikTok platform module"
```

---

## Task 11: Instagram + Facebook MVP modules

**Files:**
- Create: `admin-worker/src/platforms/instagram.js`
- Create: `admin-worker/src/platforms/facebook.js`
- Modify: `admin-worker/tests/platforms.test.js`

- [ ] **Step 1: Append failing tests**

```js
import * as instagram from '../src/platforms/instagram.js';
import * as facebook from '../src/platforms/facebook.js';

describe('instagram.parse', () => {
  it('parses /reel/ID', () => {
    expect(instagram.parse('https://www.instagram.com/reel/Cabc123/')).toMatchObject({
      valid: true, external_id: 'Cabc123'
    });
  });
  it('parses /p/ID', () => {
    expect(instagram.parse('https://www.instagram.com/p/Cabc123/')).toMatchObject({ valid: true });
  });
  it('rejects other hosts', () => {
    expect(instagram.parse('https://www.facebook.com/').valid).toBe(false);
  });
});

describe('instagram.fetchMetadata (MVP)', () => {
  it('returns placeholder metadata', async () => {
    const meta = await instagram.fetchMetadata('Cabc123', 'https://www.instagram.com/reel/Cabc123/');
    expect(meta.title).toBe('Instagram Reel');
    expect(meta.embed_url).toContain('instagram.com');
  });
});

describe('facebook.parse', () => {
  it('parses facebook.com/watch?v=ID', () => {
    expect(facebook.parse('https://www.facebook.com/watch/?v=123456789')).toMatchObject({
      valid: true, external_id: '123456789'
    });
  });
  it('parses fb.watch/SHORTCODE', () => {
    expect(facebook.parse('https://fb.watch/abc123/')).toMatchObject({ valid: true });
  });
});

describe('facebook.fetchMetadata (MVP)', () => {
  it('returns placeholder metadata', async () => {
    const meta = await facebook.fetchMetadata('123', 'https://www.facebook.com/watch/?v=123');
    expect(meta.title).toBe('Facebook Video');
    expect(meta.embed_url).toContain('facebook.com/plugins/video.php');
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/platforms/instagram.js`**

```js
const ID_RE = /^[A-Za-z0-9_-]{5,30}$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (!(u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com')) {
    return { valid: false };
  }
  const m = u.pathname.match(/^\/(reel|p|tv)\/([^/]+)/);
  if (!m || !ID_RE.test(m[2])) return { valid: false };
  return { valid: true, external_id: m[2], normalized_url: u.href };
}

export async function fetchMetadata(external_id, normalized_url) {
  return {
    title: 'Instagram Reel',
    thumbnail_url: null,
    duration_seconds: null,
    embed_url: normalized_url
  };
}
```

- [ ] **Step 4: Implement `src/platforms/facebook.js`**

```js
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function parse(url) {
  let u;
  try { u = new URL(url); } catch { return { valid: false }; }
  if (u.protocol !== 'https:') return { valid: false };
  if (u.hostname === 'www.facebook.com' || u.hostname === 'facebook.com' || u.hostname === 'm.facebook.com') {
    if (u.pathname.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v && ID_RE.test(v)) return { valid: true, external_id: v, normalized_url: u.href };
    }
    const m = u.pathname.match(/\/videos\/(\d+)/);
    if (m) return { valid: true, external_id: m[1], normalized_url: u.href };
  }
  if (u.hostname === 'fb.watch') {
    const code = u.pathname.replace(/\//g, '');
    if (code && ID_RE.test(code)) return { valid: true, external_id: code, normalized_url: u.href };
  }
  return { valid: false };
}

export async function fetchMetadata(external_id, normalized_url) {
  return {
    title: 'Facebook Video',
    thumbnail_url: null,
    duration_seconds: null,
    embed_url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(normalized_url)}`
  };
}
```

- [ ] **Step 5: Run — pass**

```bash
npx vitest run tests/platforms.test.js
```

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/platforms/instagram.js admin-worker/src/platforms/facebook.js admin-worker/tests/platforms.test.js
git commit -m "feat(admin-worker): Instagram + Facebook MVP modules"
```

---

## Task 12: Platform dispatcher

**Files:**
- Create: `admin-worker/src/platforms/index.js`
- Modify: `admin-worker/tests/platforms.test.js`

- [ ] **Step 1: Append failing tests**

```js
import { detectPlatform, parseUrl, fetchMeta } from '../src/platforms/index.js';

describe('platform dispatcher', () => {
  it('detects youtube', () => {
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube');
  });
  it('detects tiktok', () => {
    expect(detectPlatform('https://www.tiktok.com/@u/video/123')).toBe('tiktok');
  });
  it('detects instagram', () => {
    expect(detectPlatform('https://www.instagram.com/reel/Cabc/')).toBe('instagram');
  });
  it('detects facebook', () => {
    expect(detectPlatform('https://fb.watch/abc/')).toBe('facebook');
  });
  it('returns null for unsupported', () => {
    expect(detectPlatform('https://vimeo.com/x')).toBe(null);
  });

  it('parseUrl returns parsed + platform', () => {
    const r = parseUrl('https://youtu.be/cZ3GxPO4cXo');
    expect(r.platform).toBe('youtube');
    expect(r.parsed.external_id).toBe('cZ3GxPO4cXo');
  });

  it('parseUrl returns null for unsupported', () => {
    expect(parseUrl('https://vimeo.com/x')).toBe(null);
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/platforms/index.js`**

```js
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as instagram from './instagram.js';
import * as facebook from './facebook.js';

const MODULES = { youtube, tiktok, instagram, facebook };

export function detectPlatform(url) {
  let h;
  try { h = new URL(url).hostname; } catch { return null; }
  if (/(^|\.)youtube\.com$/.test(h) || h === 'youtu.be') return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)facebook\.com$/.test(h) || h === 'fb.watch') return 'facebook';
  return null;
}

export function parseUrl(url) {
  const platform = detectPlatform(url);
  if (!platform) return null;
  const parsed = MODULES[platform].parse(url);
  if (!parsed.valid) return null;
  return { platform, parsed };
}

export async function fetchMeta(platform, external_id, normalized_url) {
  return MODULES[platform].fetchMetadata(external_id, normalized_url);
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/platforms/index.js admin-worker/tests/platforms.test.js
git commit -m "feat(admin-worker): platform dispatcher"
```

---

## Task 13: Login route + worker shell

**Files:**
- Create: `admin-worker/src/index.js`
- Create: `admin-worker/src/routes/login.js`
- Create: `admin-worker/tests/routes_login.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';

async function call(method, path, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  if (!cookie) headers['CF-Connecting-IP'] = '1.2.3.4';
  const req = new Request(`https://x${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      last_login_at TEXT
    )
  `);
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
```

- [ ] **Step 2: Run — fail**

```bash
npx vitest run tests/routes_login.test.js
```

- [ ] **Step 3: Implement `src/routes/login.js`**

```js
import { verifyPassword, signJWT } from '../auth.js';
import { formatAuthCookie } from '../cookie.js';
import { recordLoginFailure, isLoginBlocked, clearLoginFailures } from '../rate_limit.js';

export async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

  if (!email || !password) return new Response('Missing fields', { status: 400 });

  if (await isLoginBlocked(env.RATE_LIMIT_KV, email, ip)) {
    return new Response('Too many attempts. Retry in 30 minutes.', { status: 429 });
  }

  const row = await env.ADMIN_DB
    .prepare('SELECT id, password_hash, password_salt, role, active FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!row || row.active !== 1) {
    await recordLoginFailure(env.RATE_LIMIT_KV, email, ip);
    return new Response('Invalid credentials', { status: 401 });
  }

  const ok = await verifyPassword(password, row.password_hash, row.password_salt);
  if (!ok) {
    await recordLoginFailure(env.RATE_LIMIT_KV, email, ip);
    console.log(`login_failure email=${email} ip=${ip}`);
    return new Response('Invalid credentials', { status: 401 });
  }

  await clearLoginFailures(env.RATE_LIMIT_KV, email);
  await env.ADMIN_DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run();

  const token = await signJWT({ uid: row.id, role: row.role }, env.JWT_SECRET, 28800);
  console.log(`login_success uid=${row.id} role=${row.role} ip=${ip}`);
  return new Response(JSON.stringify({ uid: row.id, role: row.role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': formatAuthCookie(token) }
  });
}
```

- [ ] **Step 4: Implement `src/index.js`** (router shell)

```js
import { handleLogin } from './routes/login.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
};

function withCors(env, request, response) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN;
  const h = new Headers(response.headers);
  if (origin && (origin === allowed || origin.startsWith('http://localhost'))) {
    h.set('Access-Control-Allow-Origin', origin);
    for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return withCors(env, request, new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    let response;
    try {
      if (request.method === 'POST' && url.pathname === '/api/login') {
        response = await handleLogin(request, env);
      } else {
        response = new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error('worker_error', err.stack || err.message);
      response = new Response('Internal error', { status: 500 });
    }
    return withCors(env, request, response);
  }
};
```

- [ ] **Step 5: Run — pass**

```bash
npx vitest run tests/routes_login.test.js
```

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/index.js admin-worker/src/routes/login.js admin-worker/tests/routes_login.test.js
git commit -m "feat(admin-worker): POST /api/login + worker shell"
```

---

## Task 14: Logout route

**Files:**
- Create: `admin-worker/src/routes/logout.js`
- Modify: `admin-worker/src/index.js`
- Modify: `admin-worker/tests/routes_login.test.js`

- [ ] **Step 1: Append failing test**

```js
describe('POST /api/logout', () => {
  it('returns 200 + clearing Set-Cookie', async () => {
    const res = await call('POST', '/api/logout');
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 2: Implement `src/routes/logout.js`**

```js
import { clearAuthCookie } from '../cookie.js';

export async function handleLogout() {
  return new Response(null, {
    status: 200,
    headers: { 'Set-Cookie': clearAuthCookie() }
  });
}
```

- [ ] **Step 3: Wire into `src/index.js`** — add route

```js
import { handleLogout } from './routes/logout.js';
// ...inside fetch try block, before the 404:
if (request.method === 'POST' && url.pathname === '/api/logout') {
  response = await handleLogout();
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git add admin-worker/src/routes/logout.js admin-worker/src/index.js admin-worker/tests/routes_login.test.js
git commit -m "feat(admin-worker): POST /api/logout"
```

---

## Task 15: GET /api/videos (list with filters + pagination)

**Files:**
- Create: `admin-worker/src/routes/videos.js`
- Modify: `admin-worker/src/index.js`
- Create: `admin-worker/tests/routes_videos.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { hashPassword, signJWT } from '../src/auth.js';

async function call(method, path, { body, role = 'admin', uid = 1 } = {}) {
  const token = await signJWT({ uid, role }, 'test-secret-32-bytes-fixed-string', 60);
  const headers = { 'Content-Type': 'application/json', 'Cookie': `Auth=${token}`, 'X-Requested-With': 'fetch' };
  const req = new Request(`https://x${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await env.ADMIN_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, display_name TEXT, password_hash TEXT, password_salt TEXT,
      role TEXT, active INTEGER DEFAULT 1, created_at TEXT, created_by INTEGER, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, external_id TEXT, url TEXT, embed_url TEXT,
      title TEXT, thumbnail_url TEXT, duration_seconds INTEGER, status TEXT DEFAULT 'pas_valide',
      note TEXT, added_by INTEGER, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status_changed_by INTEGER, status_changed_at TEXT, UNIQUE(platform, external_id)
    );
    CREATE TABLE IF NOT EXISTS validation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, video_id INTEGER, user_id INTEGER, action TEXT,
      previous_status TEXT, new_status TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM validation_log; DELETE FROM videos; DELETE FROM users;');
  await env.ADMIN_DB.prepare('INSERT INTO users (id, email, display_name, password_hash, password_salt, role) VALUES (1, ?, ?, ?, ?, ?)')
    .bind('admin@x', 'Admin', 'h', 's', 'admin').run();
  // seed 3 videos: 2 valide YouTube, 1 pas_valide TikTok
  await env.ADMIN_DB.prepare(
    `INSERT INTO videos (platform, external_id, url, status, added_by) VALUES
     ('youtube','y1','https://y/1','valide',1),
     ('youtube','y2','https://y/2','valide',1),
     ('tiktok','t1','https://t/1','pas_valide',1)`
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
    const req = new Request('https://x/api/videos');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/routes/videos.js`** (listVideos only for now)

```js
import { requireAuth } from '../auth.js';

const VALID_STATUS = new Set(['valide', 'pas_valide']);
const VALID_PLATFORM = new Set(['youtube', 'tiktok', 'instagram', 'facebook']);

export async function listVideos(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin', 'verificateur']);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const platform = url.searchParams.get('platform');
  const search = url.searchParams.get('q');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || '30', 10)));

  const where = [];
  const args = [];
  if (status && VALID_STATUS.has(status)) { where.push('status = ?'); args.push(status); }
  if (platform && VALID_PLATFORM.has(platform)) { where.push('platform = ?'); args.push(platform); }
  if (search) { where.push('(title LIKE ? OR url LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.ADMIN_DB.prepare(`SELECT COUNT(*) AS n FROM videos ${whereClause}`).bind(...args).first();
  const items = await env.ADMIN_DB
    .prepare(`SELECT * FROM videos ${whereClause} ORDER BY added_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, perPage, (page - 1) * perPage)
    .all();

  return new Response(JSON.stringify({
    items: items.results,
    total: totalRow.n,
    page, per_page: perPage
  }), { headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listVideos } from './routes/videos.js';
// ...
if (request.method === 'GET' && url.pathname === '/api/videos') {
  response = await listVideos(request, env);
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/videos.js admin-worker/src/index.js admin-worker/tests/routes_videos.test.js
git commit -m "feat(admin-worker): GET /api/videos with filters + pagination"
```

---

## Task 16: POST /api/videos (add)

**Files:**
- Modify: `admin-worker/src/routes/videos.js`
- Modify: `admin-worker/src/index.js`
- Modify: `admin-worker/tests/routes_videos.test.js`

- [ ] **Step 1: Append failing tests**

```js
import { vi } from 'vitest';

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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Append to `src/routes/videos.js`**

```js
import { parseUrl, fetchMeta } from '../platforms/index.js';

export async function addVideo(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin', 'verificateur']);
  if (auth.error) return auth.error;

  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const url = String(body.url || '').trim();
  if (!url) return new Response('Missing url', { status: 400 });

  const parsed = parseUrl(url);
  if (!parsed) return new Response('Unsupported platform or malformed URL', { status: 400 });

  const meta = await fetchMeta(parsed.platform, parsed.parsed.external_id, parsed.parsed.normalized_url);

  try {
    const result = await env.ADMIN_DB.prepare(
      `INSERT INTO videos (platform, external_id, url, embed_url, title, thumbnail_url, duration_seconds, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      parsed.platform, parsed.parsed.external_id, parsed.parsed.normalized_url,
      meta.embed_url, meta.title, meta.thumbnail_url, meta.duration_seconds,
      auth.user.uid
    ).run();
    const id = result.meta.last_row_id;

    await env.ADMIN_DB.prepare(
      `INSERT INTO validation_log (video_id, user_id, action, new_status) VALUES (?, ?, 'added', 'pas_valide')`
    ).bind(id, auth.user.uid).run();

    const row = await env.ADMIN_DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();
    return new Response(JSON.stringify(row), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return new Response('Video already exists', { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listVideos, addVideo } from './routes/videos.js';
// ...
if (request.method === 'POST' && url.pathname === '/api/videos') {
  response = await addVideo(request, env);
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/videos.js admin-worker/src/index.js admin-worker/tests/routes_videos.test.js
git commit -m "feat(admin-worker): POST /api/videos with platform detection"
```

---

## Task 17: PATCH /api/videos/:id (status + note)

**Files:**
- Modify: `admin-worker/src/routes/videos.js`
- Modify: `admin-worker/src/index.js`
- Modify: `admin-worker/tests/routes_videos.test.js`

- [ ] **Step 1: Append failing tests**

```js
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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Append to `src/routes/videos.js`**

```js
export async function patchVideo(request, env, id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin', 'verificateur']);
  if (auth.error) return auth.error;

  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const newStatus = body.status;
  const newNote = body.note;

  if (newStatus !== undefined && !VALID_STATUS.has(newStatus)) {
    return new Response('Invalid status', { status: 400 });
  }
  if (newNote !== undefined && (typeof newNote !== 'string' || newNote.length > 2000)) {
    return new Response('Invalid note', { status: 400 });
  }

  const video = await env.ADMIN_DB.prepare('SELECT id, status FROM videos WHERE id = ?').bind(id).first();
  if (!video) return new Response('Not found', { status: 404 });

  let action = null;
  if (newStatus !== undefined && newStatus !== video.status) {
    action = newStatus === 'valide' ? 'validated' : 'unvalidated';
    await env.ADMIN_DB.prepare(
      `UPDATE videos SET status = ?, note = COALESCE(?, note), status_changed_by = ?, status_changed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(newStatus, newNote ?? null, auth.user.uid, id).run();
  } else if (newNote !== undefined) {
    action = 'noted';
    await env.ADMIN_DB.prepare('UPDATE videos SET note = ? WHERE id = ?').bind(newNote, id).run();
  } else {
    return new Response('Nothing to update', { status: 400 });
  }

  await env.ADMIN_DB.prepare(
    `INSERT INTO validation_log (video_id, user_id, action, previous_status, new_status, note) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.user.uid, action, video.status, newStatus ?? video.status, newNote ?? null).run();

  const row = await env.ADMIN_DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify(row), { headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listVideos, addVideo, patchVideo } from './routes/videos.js';
// ...
const videoIdMatch = url.pathname.match(/^\/api\/videos\/(\d+)$/);
if (videoIdMatch && request.method === 'PATCH') {
  response = await patchVideo(request, env, parseInt(videoIdMatch[1], 10));
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/videos.js admin-worker/src/index.js admin-worker/tests/routes_videos.test.js
git commit -m "feat(admin-worker): PATCH /api/videos/:id status+note with audit log"
```

---

## Task 18: DELETE /api/videos/:id + GET /api/videos/:id (detail + history)

**Files:**
- Modify: `admin-worker/src/routes/videos.js`
- Modify: `admin-worker/src/index.js`
- Modify: `admin-worker/tests/routes_videos.test.js`

- [ ] **Step 1: Append failing tests**

```js
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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Append to `src/routes/videos.js`**

```js
export async function deleteVideo(request, env, id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;

  const v = await env.ADMIN_DB.prepare('SELECT id FROM videos WHERE id = ?').bind(id).first();
  if (!v) return new Response('Not found', { status: 404 });

  // Log before delete (CASCADE will kill the log row too — that's by design for the video,
  // but we want a top-level audit trail. Solution: log to a parallel table OR keep the log
  // by NOT cascading from this action — we accept the cascade for MVP since the deletion
  // itself is recorded server-side via console.log)
  console.log(`video_deleted id=${id} by=${auth.user.uid}`);
  await env.ADMIN_DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204 });
}

export async function getVideo(request, env, id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin', 'verificateur']);
  if (auth.error) return auth.error;

  const video = await env.ADMIN_DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();
  if (!video) return new Response('Not found', { status: 404 });
  const history = await env.ADMIN_DB.prepare(
    `SELECT l.id, l.action, l.previous_status, l.new_status, l.note, l.created_at, u.email AS user_email, u.display_name AS user_name
     FROM validation_log l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.video_id = ? ORDER BY l.id DESC`
  ).bind(id).all();

  return new Response(JSON.stringify({ video, history: history.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listVideos, addVideo, patchVideo, deleteVideo, getVideo } from './routes/videos.js';
// ...inside the matched videoIdMatch:
if (videoIdMatch) {
  const vid = parseInt(videoIdMatch[1], 10);
  if (request.method === 'GET') response = await getVideo(request, env, vid);
  else if (request.method === 'PATCH') response = await patchVideo(request, env, vid);
  else if (request.method === 'DELETE') response = await deleteVideo(request, env, vid);
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/videos.js admin-worker/src/index.js admin-worker/tests/routes_videos.test.js
git commit -m "feat(admin-worker): DELETE + GET /api/videos/:id"
```

---

## Task 19: Users CRUD routes

**Files:**
- Create: `admin-worker/src/routes/users.js`
- Modify: `admin-worker/src/index.js`
- Create: `admin-worker/tests/routes_users.test.js`

- [ ] **Step 1: Write failing tests** (mirror routes_videos.test.js pattern)

```js
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
  await env.ADMIN_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, display_name TEXT,
      password_hash TEXT, password_salt TEXT, role TEXT,
      active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, platform TEXT, external_id TEXT, url TEXT, added_by INTEGER);
  `);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM videos; DELETE FROM users;');
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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/routes/users.js`**

```js
import { requireAuth, hashPassword } from '../auth.js';

const VALID_ROLES = new Set(['admin', 'verificateur']);

export async function listUsers(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  const rows = await env.ADMIN_DB.prepare(
    `SELECT id, email, display_name, role, active, created_at, last_login_at FROM users ORDER BY id ASC`
  ).all();
  return new Response(JSON.stringify({ items: rows.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function createUser(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  const display_name = String(body.display_name || '').trim();
  const password = String(body.password || '');
  const role = body.role;

  if (!email || email.length > 254) return new Response('Invalid email', { status: 400 });
  if (!display_name || display_name.length > 200) return new Response('Invalid display_name', { status: 400 });
  if (password.length < 8) return new Response('Password too short (min 8)', { status: 400 });
  if (!VALID_ROLES.has(role)) return new Response('Invalid role', { status: 400 });

  const { hash, salt } = await hashPassword(password);
  try {
    const result = await env.ADMIN_DB.prepare(
      `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_by) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(email, display_name, hash, salt, role, auth.user.uid).run();
    const row = await env.ADMIN_DB.prepare(
      `SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?`
    ).bind(result.meta.last_row_id).first();
    return new Response(JSON.stringify(row), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return new Response('Email already exists', { status: 409 });
    throw e;
  }
}

export async function patchUser(request, env, id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const updates = [];
  const args = [];
  if (body.active !== undefined) { updates.push('active = ?'); args.push(body.active ? 1 : 0); }
  if (body.display_name !== undefined) { updates.push('display_name = ?'); args.push(String(body.display_name).trim()); }
  if (body.role !== undefined) {
    if (!VALID_ROLES.has(body.role)) return new Response('Invalid role', { status: 400 });
    if (id === auth.user.uid && body.role !== 'admin') {
      return new Response('Cannot demote self', { status: 400 });
    }
    updates.push('role = ?'); args.push(body.role);
  }
  if (!updates.length) return new Response('Nothing to update', { status: 400 });
  args.push(id);

  const result = await env.ADMIN_DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...args).run();
  if (result.meta.changes === 0) return new Response('Not found', { status: 404 });

  const row = await env.ADMIN_DB.prepare(
    `SELECT id, email, display_name, role, active FROM users WHERE id = ?`
  ).bind(id).first();
  return new Response(JSON.stringify(row), { headers: { 'Content-Type': 'application/json' } });
}

export async function deleteUser(request, env, id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  if (id === auth.user.uid) return new Response('Cannot delete self', { status: 400 });
  const exists = await env.ADMIN_DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!exists) return new Response('Not found', { status: 404 });
  try {
    await env.ADMIN_DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (e) {
    if (String(e.message).match(/FOREIGN KEY|RESTRICT/i)) {
      return new Response('User has videos; transfer or delete them first', { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listUsers, createUser, patchUser, deleteUser } from './routes/users.js';
// ...
const userIdMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
if (url.pathname === '/api/users' && request.method === 'GET') response = await listUsers(request, env);
else if (url.pathname === '/api/users' && request.method === 'POST') response = await createUser(request, env);
else if (userIdMatch) {
  const uid = parseInt(userIdMatch[1], 10);
  if (request.method === 'PATCH') response = await patchUser(request, env, uid);
  else if (request.method === 'DELETE') response = await deleteUser(request, env, uid);
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/users.js admin-worker/src/index.js admin-worker/tests/routes_users.test.js
git commit -m "feat(admin-worker): users CRUD (admin only)"
```

---

## Task 20: GET /api/public/videos (no-auth)

**Files:**
- Create: `admin-worker/src/routes/public.js`
- Modify: `admin-worker/src/index.js`
- Create: `admin-worker/tests/routes_public.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

beforeAll(async () => {
  await env.ADMIN_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY, platform TEXT, external_id TEXT, url TEXT, embed_url TEXT,
      title TEXT, thumbnail_url TEXT, duration_seconds INTEGER, status TEXT, added_by INTEGER, added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

beforeEach(async () => {
  await env.ADMIN_DB.exec('DELETE FROM videos;');
  await env.ADMIN_DB.prepare(`INSERT INTO videos (platform, external_id, url, status, added_by) VALUES
    ('youtube','y1','https://y/1','valide',1),
    ('youtube','y2','https://y/2','pas_valide',1)`).run();
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
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/routes/public.js`**

```js
export async function listPublicVideos(request, env) {
  const rows = await env.ADMIN_DB.prepare(
    `SELECT id, platform, external_id, url, embed_url, title, thumbnail_url, duration_seconds, added_at
     FROM videos WHERE status = 'valide' ORDER BY added_at DESC`
  ).all();
  return new Response(JSON.stringify({ items: rows.results }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, max-age=30'
    }
  });
}
```

- [ ] **Step 4: Wire into `src/index.js`**

```js
import { listPublicVideos } from './routes/public.js';
// ...
if (request.method === 'GET' && url.pathname === '/api/public/videos') {
  response = await listPublicVideos(request, env);
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
git add admin-worker/src/routes/public.js admin-worker/src/index.js admin-worker/tests/routes_public.test.js
git commit -m "feat(admin-worker): GET /api/public/videos no-auth with CDN cache"
```

---

## Task 21: Run full test suite + initial Worker deploy

**Files:** none

- [ ] **Step 1: Full vitest run**

```bash
cd admin-worker && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Deploy Worker**

```bash
npx wrangler deploy
```

Expected: `✨ Successfully published your script to https://tayyibat-admin.<account>.workers.dev`.

- [ ] **Step 3: Seed initial admin user** (one-shot SQL command)

```bash
# Hash the INITIAL_ADMIN_PASSWORD using a node one-liner that reuses src/auth.js
node --input-type=module -e "
import { hashPassword } from './src/auth.js';
const pw = process.env.INITIAL_ADMIN_PASSWORD;
const { hash, salt } = await hashPassword(pw);
console.log(\`INSERT INTO users (email, display_name, password_hash, password_salt, role) VALUES ('houcemben@gmail.com','Houcem','\${hash}','\${salt}','admin');\`);
" > /tmp/seed_admin.sql

# Source the secret value from .dev.vars (or paste manually)
INITIAL_ADMIN_PASSWORD=$(grep INITIAL_ADMIN_PASSWORD .dev.vars | cut -d= -f2) npx wrangler d1 execute tayyibat-admin-db --remote --file=/tmp/seed_admin.sql
rm /tmp/seed_admin.sql
```

- [ ] **Step 4: Smoke test login via curl**

```bash
curl -sS -X POST https://tayyibat-admin.<account>.workers.dev/api/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"houcemben@gmail.com\",\"password\":\"$INITIAL_ADMIN_PASSWORD\"}" \
  -D -
```

Expected: `HTTP/2 200` + `set-cookie: Auth=...; HttpOnly; ...` header.

- [ ] **Step 5: Commit any test fixes**

```bash
git add -A admin-worker/
git commit -m "test(admin-worker): full suite green + deployed Worker"
```

---

## Task 22: Seed script for 185 testimonials

**Files:**
- Create: `admin-worker/scripts/seed_testimonials.mjs`

- [ ] **Step 1: Implement `admin-worker/scripts/seed_testimonials.mjs`**

```js
#!/usr/bin/env node
/*
 * Extracts the `const VIDEOS = [...]` array from temoignages.html and inserts
 * each video into the D1 `videos` table with status='pas_valide', added_by=1.
 * Idempotent: uses INSERT OR IGNORE on the UNIQUE(platform, external_id) index.
 *
 * Usage:
 *   node scripts/seed_testimonials.mjs --remote
 *   node scripts/seed_testimonials.mjs --local
 */
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

const flag = process.argv.includes('--remote') ? '--remote' : '--local';
const stmts = videos.map(v => {
  const url = v.url.replace(/'/g, "''");
  const title = (v.title || '').replace(/'/g, "''");
  const thumb = (v.thumb || '').replace(/'/g, "''");
  return `INSERT OR IGNORE INTO videos (platform, external_id, url, embed_url, title, thumbnail_url, added_by, status) VALUES ('youtube','${v.id}','${url}','https://www.youtube.com/embed/${v.id}','${title}','${thumb}',1,'pas_valide');`;
});
// Add audit log inserts for each (joined later by id; since we use INSERT OR IGNORE
// we can't easily resolve id — log via a follow-up query)
stmts.push(`INSERT INTO validation_log (video_id, user_id, action, new_status)
  SELECT v.id, 1, 'added', 'pas_valide' FROM videos v
  WHERE v.platform='youtube' AND v.external_id IN (${videos.map(v => `'${v.id}'`).join(',')})
  AND NOT EXISTS (SELECT 1 FROM validation_log l WHERE l.video_id = v.id AND l.action = 'added');`);

const tmp = '/tmp/seed_testimonials.sql';
writeFileSync(tmp, stmts.join('\n'));
console.log(`Wrote ${stmts.length} statements to ${tmp}. Executing on D1 ${flag}...`);

execSync(`npx wrangler d1 execute tayyibat-admin-db ${flag} --file=${tmp}`, { stdio: 'inherit', cwd: __dirname + '/..' });
console.log('Done.');
```

- [ ] **Step 2: Apply remotely**

```bash
cd admin-worker && node scripts/seed_testimonials.mjs --remote
```

Expected: `Found 185 videos` + D1 confirmation of N rows changed.

- [ ] **Step 3: Verify**

```bash
npx wrangler d1 execute tayyibat-admin-db --remote --command="SELECT COUNT(*) FROM videos WHERE platform='youtube' AND status='pas_valide';"
```

Expected: ~185.

- [ ] **Step 4: Commit**

```bash
git add admin-worker/scripts/seed_testimonials.mjs
git commit -m "feat(admin-worker): seed 185 testimonials from temoignages.html"
```

---

## Task 23: admin.html — Login view

**Files:**
- Create: `admin.html`

- [ ] **Step 1: Create `admin.html`** at repo root (full file, no inline VIDEOS)

```html
<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Système Tayyibat</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --gold: #C9A84C; --dark: #1A1A18; --dark-2: #2C2C28; --cream: #F5F0E8;
    --text: #1A1A18; --text-muted: #6B6B60; --danger: #B33A3A; --ok: #2E7D5B;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Source Sans 3', system-ui, sans-serif; background: var(--cream); color: var(--text); margin: 0; padding: 0; }
  header { background: var(--dark); color: var(--cream); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-family: 'Cairo', serif; font-weight: 700; font-size: 20px; margin: 0; color: var(--gold); }
  header nav { display: flex; gap: 16px; align-items: center; }
  header nav button { background: transparent; color: var(--cream); border: 1px solid var(--gold); padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 14px; }
  header nav button:hover { background: var(--gold); color: var(--dark); }
  header nav button.active { background: var(--gold); color: var(--dark); }
  main { padding: 32px 24px; max-width: 1200px; margin: 0 auto; }
  .login-card { max-width: 400px; margin: 60px auto; background: white; padding: 32px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .login-card h2 { margin-top: 0; color: var(--dark); }
  label { display: block; margin: 12px 0 4px; font-size: 14px; }
  input[type="email"], input[type="password"], input[type="text"], textarea, select {
    width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; font-family: inherit;
  }
  button.primary { background: var(--gold); color: var(--dark); border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 15px; margin-top: 16px; width: 100%; }
  button.primary:hover { background: var(--dark); color: var(--gold); }
  .error { color: var(--danger); font-size: 13px; margin-top: 8px; min-height: 18px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<header>
  <h1>Tayyibat Admin</h1>
  <nav id="nav" class="hidden">
    <button data-view="videos" class="active">Vidéos</button>
    <button data-view="users" id="nav-users">Utilisateurs</button>
    <span id="user-info" style="font-size: 13px; color: var(--cream);"></span>
    <button id="logout-btn">Déconnexion</button>
  </nav>
</header>

<main>
  <div id="login-view" class="login-card">
    <h2>Connexion</h2>
    <form id="login-form">
      <label for="email">Email</label>
      <input type="email" id="email" required autocomplete="username">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" required autocomplete="current-password">
      <button type="submit" class="primary">Se connecter</button>
      <div class="error" id="login-error"></div>
    </form>
  </div>

  <div id="videos-view" class="hidden"></div>
  <div id="users-view" class="hidden"></div>
</main>

<script type="module">
  const API_BASE = 'https://tayyibat-admin.<REPLACE_ACCOUNT>.workers.dev';

  // --- API client ---
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${API_BASE}${path}`, opts);
    if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(txt || `HTTP ${r.status}`);
    }
    if (r.status === 204) return null;
    return r.json();
  }

  // --- View management ---
  let currentUser = null;
  function showLogin() {
    currentUser = null;
    document.getElementById('nav').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('videos-view').classList.add('hidden');
    document.getElementById('users-view').classList.add('hidden');
  }
  function showApp(user) {
    currentUser = user;
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('nav').classList.remove('hidden');
    document.getElementById('user-info').textContent = `${user.role} • uid ${user.uid}`;
    document.getElementById('nav-users').style.display = user.role === 'admin' ? '' : 'none';
    showView('videos');
  }
  function showView(name) {
    for (const v of ['videos', 'users']) {
      document.getElementById(`${v}-view`).classList.toggle('hidden', v !== name);
    }
    for (const b of document.querySelectorAll('#nav button[data-view]')) {
      b.classList.toggle('active', b.dataset.view === name);
    }
  }

  // --- Login ---
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    err.textContent = '';
    try {
      const user = await api('POST', '/api/login', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      });
      showApp(user);
    } catch (e) {
      err.textContent = e.message === 'unauthorized' ? 'Identifiants invalides.' : e.message;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    showLogin();
  });

  for (const b of document.querySelectorAll('#nav button[data-view]')) {
    b.addEventListener('click', () => showView(b.dataset.view));
  }

  // Auto-detect existing session: try fetching /api/videos
  api('GET', '/api/videos?per_page=1').then(() => {
    // Cookie still valid — we'll fetch the user info from the token on next interaction.
    // For MVP, assume admin (the only login route returns role; we don't have a /me endpoint).
    // The UI will gracefully fall back to login on any 401.
    showApp({ uid: '?', role: 'admin' });
  }).catch(() => showLogin());

  // Expose for next tasks
  window.__api = api;
  window.__showView = showView;
  window.__currentUser = () => currentUser;
</script>
</body>
</html>
```

- [ ] **Step 2: Replace `<REPLACE_ACCOUNT>` with actual subdomain** from Task 21 step 2 output.

- [ ] **Step 3: Local smoke test** — open `admin.html` directly in browser:

```bash
xdg-open admin.html 2>/dev/null || open admin.html
```

Verify login form loads. Submit with admin creds. Verify either successful login (navigation appears) or clear error message.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat(admin): admin.html login view"
```

---

## Task 24: admin.html — Videos list view

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Inside the `<script type="module">` block, add the videos view renderer** (append before `// Expose for next tasks`):

```js
// --- Videos view ---
let videosState = { items: [], total: 0, page: 1, per_page: 30, filters: {} };

async function loadVideos() {
  const params = new URLSearchParams();
  params.set('page', videosState.page);
  params.set('per_page', videosState.per_page);
  for (const [k, v] of Object.entries(videosState.filters)) {
    if (v) params.set(k, v);
  }
  const j = await api('GET', `/api/videos?${params}`);
  videosState.items = j.items;
  videosState.total = j.total;
  renderVideos();
}

function renderVideos() {
  const v = document.getElementById('videos-view');
  v.innerHTML = `
    <div style="display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; align-items:center;">
      <input type="text" id="search-input" placeholder="Rechercher titre/URL..." style="flex:1; min-width:200px;" value="${videosState.filters.q || ''}">
      <select id="status-filter" style="width:auto;">
        <option value="">Tous statuts</option>
        <option value="valide" ${videosState.filters.status === 'valide' ? 'selected' : ''}>Validé</option>
        <option value="pas_valide" ${videosState.filters.status === 'pas_valide' ? 'selected' : ''}>Pas validé</option>
      </select>
      <select id="platform-filter" style="width:auto;">
        <option value="">Toutes plateformes</option>
        ${['youtube', 'tiktok', 'instagram', 'facebook'].map(p => `<option value="${p}" ${videosState.filters.platform === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <button class="primary" id="add-video-btn" style="margin-top:0; width:auto;">+ Ajouter vidéo</button>
    </div>
    <p style="color:var(--text-muted)">Total : ${videosState.total} vidéo(s)</p>
    <div id="video-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:16px;"></div>
    <div id="pagination" style="text-align:center; margin-top:24px;"></div>
  `;

  const grid = document.getElementById('video-grid');
  for (const item of videosState.items) {
    const card = document.createElement('article');
    card.style.cssText = 'background:white; border-radius:6px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.06); cursor:pointer;';
    card.innerHTML = `
      ${item.thumbnail_url ? `<img src="${item.thumbnail_url}" alt="" style="width:100%; display:block; aspect-ratio:16/9; object-fit:cover; background:#eee;">` : `<div style="aspect-ratio:16/9; background:#eee; display:flex; align-items:center; justify-content:center; color:#aaa;">${item.platform}</div>`}
      <div style="padding:12px;">
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">
          <span style="background:var(--dark); color:var(--cream); padding:2px 6px; border-radius:3px; font-size:11px; margin-right:6px;">${item.platform}</span>
          <span style="background:${item.status === 'valide' ? 'var(--ok)' : 'var(--danger)'}; color:white; padding:2px 6px; border-radius:3px; font-size:11px;">${item.status === 'valide' ? 'validé' : 'pas validé'}</span>
        </div>
        <div style="font-size:14px; line-height:1.3;"></div>
      </div>
    `;
    card.querySelector('div:last-child > div:last-child').textContent = item.title || '(sans titre)';
    card.addEventListener('click', () => openVideoDetail(item.id));
    grid.appendChild(card);
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(videosState.total / videosState.per_page));
  document.getElementById('pagination').innerHTML = totalPages > 1
    ? `Page ${videosState.page}/${totalPages} <button id="prev" ${videosState.page <= 1 ? 'disabled' : ''}>‹</button> <button id="next" ${videosState.page >= totalPages ? 'disabled' : ''}>›</button>`
    : '';

  // Wire filters
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { videosState.filters.q = e.target.value; videosState.page = 1; loadVideos(); }, 250);
  });
  document.getElementById('status-filter').addEventListener('change', (e) => {
    videosState.filters.status = e.target.value; videosState.page = 1; loadVideos();
  });
  document.getElementById('platform-filter').addEventListener('change', (e) => {
    videosState.filters.platform = e.target.value; videosState.page = 1; loadVideos();
  });
  document.getElementById('add-video-btn').addEventListener('click', openAddVideoModal);
  document.getElementById('prev')?.addEventListener('click', () => { videosState.page--; loadVideos(); });
  document.getElementById('next')?.addEventListener('click', () => { videosState.page++; loadVideos(); });
}

// Placeholder for next tasks
function openVideoDetail(id) { alert('Detail modal — Task 25'); }
function openAddVideoModal() { alert('Add modal — Task 26'); }

// Hook into existing showView
const origShowView = showView;
showView = function(name) {
  origShowView(name);
  if (name === 'videos') loadVideos();
};
```

- [ ] **Step 2: Deploy Pages** (preview the change)

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
ARCHIVE_TARGET=$(readlink archive) && rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s "$ARCHIVE_TARGET" archive
```

- [ ] **Step 3: Open in browser, log in, verify grid renders with the 185 seeded videos** (all should appear as `pas validé`).

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat(admin): videos list view + filters + pagination"
```

---

## Task 25: admin.html — Video detail modal

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Replace `function openVideoDetail(id)` with a real implementation**

```js
async function openVideoDetail(id) {
  const { video, history } = await api('GET', `/api/videos/${id}`);
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:100; padding:24px;';
  const isAdmin = currentUser?.role === 'admin';
  modal.innerHTML = `
    <div style="background:white; border-radius:8px; max-width:720px; width:100%; max-height:90vh; overflow-y:auto; padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:16px;">
        <h2 style="margin:0; font-family:Cairo,serif;"></h2>
        <button id="close-modal" style="background:none; border:none; font-size:24px; cursor:pointer;">×</button>
      </div>
      <div id="embed-container" style="aspect-ratio:16/9; background:#000; margin-bottom:16px;"></div>
      <p style="font-size:13px; color:var(--text-muted);">
        Plateforme : <strong>${video.platform}</strong> ·
        URL : <a href="${video.url}" target="_blank" rel="noopener">${video.url}</a>
      </p>
      <label for="note-input">Note (optionnel)</label>
      <textarea id="note-input" rows="3" maxlength="2000"></textarea>
      <div style="margin-top:16px; display:flex; gap:12px; flex-wrap:wrap;">
        <button class="primary" id="toggle-status" style="margin-top:0; flex:1; min-width:160px;">
          ${video.status === 'valide' ? '✗ Marquer pas validé' : '✓ Marquer validé'}
        </button>
        ${isAdmin ? `<button id="delete-video" style="background:var(--danger); color:white; border:none; padding:12px 20px; border-radius:4px; cursor:pointer;">Supprimer</button>` : ''}
      </div>
      <h3 style="margin-top:24px; font-size:14px; text-transform:uppercase; color:var(--text-muted);">Historique</h3>
      <ul id="history-list" style="list-style:none; padding:0; font-size:13px;"></ul>
    </div>
  `;
  modal.querySelector('h2').textContent = video.title || '(sans titre)';
  modal.querySelector('#note-input').value = video.note || '';

  // Embed by platform
  const emb = modal.querySelector('#embed-container');
  if (video.platform === 'youtube') {
    emb.innerHTML = `<iframe width="100%" height="100%" src="${video.embed_url}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  } else if (video.platform === 'tiktok') {
    emb.innerHTML = `<blockquote class="tiktok-embed" cite="${video.url}" style="background:white;"><a href="${video.url}">Voir sur TikTok</a></blockquote>`;
    if (!document.getElementById('tiktok-script')) {
      const s = document.createElement('script'); s.id = 'tiktok-script'; s.src = 'https://www.tiktok.com/embed.js'; document.body.appendChild(s);
    }
  } else if (video.platform === 'instagram') {
    emb.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${video.url}" style="background:white;"><a href="${video.url}">Voir sur Instagram</a></blockquote>`;
    if (!document.getElementById('ig-script')) {
      const s = document.createElement('script'); s.id = 'ig-script'; s.src = 'https://www.instagram.com/embed.js'; document.body.appendChild(s);
    }
  } else if (video.platform === 'facebook') {
    emb.innerHTML = `<iframe width="100%" height="100%" src="${video.embed_url}" allowfullscreen></iframe>`;
  }

  // History list
  const ul = modal.querySelector('#history-list');
  for (const h of history) {
    const li = document.createElement('li');
    li.style.cssText = 'padding:6px 0; border-bottom:1px solid #eee;';
    li.textContent = `[${h.created_at}] ${h.user_name || '(supprimé)'} — ${h.action}${h.new_status ? ` → ${h.new_status}` : ''}${h.note ? ` (« ${h.note} »)` : ''}`;
    ul.appendChild(li);
  }

  modal.querySelector('#close-modal').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#toggle-status').addEventListener('click', async () => {
    const newStatus = video.status === 'valide' ? 'pas_valide' : 'valide';
    const note = modal.querySelector('#note-input').value;
    try {
      await api('PATCH', `/api/videos/${id}`, { status: newStatus, note: note || undefined });
      modal.remove();
      loadVideos();
    } catch (e) { alert(`Erreur : ${e.message}`); }
  });

  if (isAdmin) {
    modal.querySelector('#delete-video').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette vidéo ?')) return;
      try {
        await api('DELETE', `/api/videos/${id}`);
        modal.remove();
        loadVideos();
      } catch (e) { alert(`Erreur : ${e.message}`); }
    });
  }

  document.body.appendChild(modal);
}
```

- [ ] **Step 2: Re-deploy Pages**

```bash
ARCHIVE_TARGET=$(readlink archive) && rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s "$ARCHIVE_TARGET" archive
```

- [ ] **Step 3: Browser smoke test** — open a video, embed loads, toggle status, history shows entry.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat(admin): video detail modal with embed + history"
```

---

## Task 26: admin.html — Add video modal

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Replace `function openAddVideoModal()` with real implementation**

```js
function openAddVideoModal() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:100; padding:24px;';
  modal.innerHTML = `
    <div style="background:white; border-radius:8px; max-width:480px; width:100%; padding:24px;">
      <h2 style="margin-top:0; font-family:Cairo,serif;">Ajouter une vidéo</h2>
      <label for="add-url">URL (YouTube, TikTok, Instagram Reel/Post, Facebook video)</label>
      <input type="text" id="add-url" placeholder="https://...">
      <button class="primary" id="submit-add">Ajouter</button>
      <div class="error" id="add-error"></div>
      <button id="cancel-add" style="background:none; border:none; color:var(--text-muted); cursor:pointer; margin-top:8px;">Annuler</button>
    </div>
  `;
  document.body.appendChild(modal);
  const input = modal.querySelector('#add-url');
  input.focus();

  modal.querySelector('#cancel-add').addEventListener('click', () => modal.remove());
  modal.querySelector('#submit-add').addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) return;
    const err = modal.querySelector('#add-error');
    err.textContent = '';
    try {
      await api('POST', '/api/videos', { url });
      modal.remove();
      videosState.page = 1; videosState.filters.status = 'pas_valide';
      document.getElementById('status-filter').value = 'pas_valide';
      loadVideos();
    } catch (e) { err.textContent = e.message; }
  });
}
```

- [ ] **Step 2: Re-deploy + browser test** (add a YouTube URL, see it appear in `pas_valide`)

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat(admin): add video modal"
```

---

## Task 27: admin.html — Users management view (admin only)

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: After `videos view` block, add users view code** (before `Hook into existing showView`):

```js
// --- Users view ---
async function loadUsers() {
  const j = await api('GET', '/api/users');
  const v = document.getElementById('users-view');
  v.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <h2 style="font-family:Cairo,serif; margin:0;">Utilisateurs (${j.items.length})</h2>
      <button class="primary" id="add-user-btn" style="margin-top:0; width:auto;">+ Ajouter vérificateur</button>
    </div>
    <table style="width:100%; border-collapse:collapse; background:white;">
      <thead><tr style="background:var(--dark); color:var(--cream);">
        <th style="padding:10px; text-align:left;">Email</th>
        <th style="padding:10px; text-align:left;">Nom</th>
        <th style="padding:10px; text-align:left;">Rôle</th>
        <th style="padding:10px; text-align:left;">Dernière connexion</th>
        <th style="padding:10px; text-align:left;">Actif</th>
        <th style="padding:10px; text-align:left;">Actions</th>
      </tr></thead>
      <tbody id="user-tbody"></tbody>
    </table>
  `;
  const tbody = document.getElementById('user-tbody');
  for (const u of j.items) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #eee';
    const isSelf = (currentUser?.uid !== '?' && u.id === currentUser?.uid);
    tr.innerHTML = `
      <td style="padding:10px;"></td>
      <td style="padding:10px;"></td>
      <td style="padding:10px;">${u.role}</td>
      <td style="padding:10px;">${u.last_login_at || '—'}</td>
      <td style="padding:10px;">${u.active ? '✓' : '✗'}</td>
      <td style="padding:10px;">
        ${isSelf ? '<em>(vous)</em>' : `
          <button data-action="toggle" data-id="${u.id}" data-active="${u.active}">${u.active ? 'Désactiver' : 'Réactiver'}</button>
          <button data-action="delete" data-id="${u.id}" style="background:var(--danger); color:white; border:none; padding:4px 10px; border-radius:3px; cursor:pointer; margin-left:6px;">Supprimer</button>
        `}
      </td>
    `;
    tr.children[0].textContent = u.email;
    tr.children[1].textContent = u.display_name;
    tbody.appendChild(tr);
  }

  document.getElementById('add-user-btn').addEventListener('click', openAddUserModal);
  for (const b of tbody.querySelectorAll('button[data-action]')) {
    const id = parseInt(b.dataset.id, 10);
    if (b.dataset.action === 'toggle') {
      b.addEventListener('click', async () => {
        await api('PATCH', `/api/users/${id}`, { active: b.dataset.active !== '1' });
        loadUsers();
      });
    } else if (b.dataset.action === 'delete') {
      b.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement cet utilisateur ?')) return;
        try { await api('DELETE', `/api/users/${id}`); loadUsers(); }
        catch (e) { alert(e.message); }
      });
    }
  }
}

function openAddUserModal() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:100; padding:24px;';
  modal.innerHTML = `
    <div style="background:white; border-radius:8px; max-width:480px; width:100%; padding:24px;">
      <h2 style="margin-top:0; font-family:Cairo,serif;">Ajouter un vérificateur</h2>
      <label>Email <input type="email" id="u-email" required></label>
      <label>Nom <input type="text" id="u-name" required></label>
      <label>Mot de passe (min 8) <input type="password" id="u-pw" required minlength="8"></label>
      <input type="hidden" id="u-role" value="verificateur">
      <button class="primary" id="u-submit">Créer</button>
      <div class="error" id="u-err"></div>
      <button id="u-cancel" style="background:none; border:none; color:var(--text-muted); cursor:pointer; margin-top:8px;">Annuler</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#u-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#u-submit').addEventListener('click', async () => {
    const err = modal.querySelector('#u-err'); err.textContent = '';
    try {
      await api('POST', '/api/users', {
        email: modal.querySelector('#u-email').value,
        display_name: modal.querySelector('#u-name').value,
        password: modal.querySelector('#u-pw').value,
        role: 'verificateur'
      });
      modal.remove(); loadUsers();
    } catch (e) { err.textContent = e.message; }
  });
}
```

- [ ] **Step 2: Update the `showView` hook**

Replace `if (name === 'videos') loadVideos();` with:

```js
if (name === 'videos') loadVideos();
else if (name === 'users') loadUsers();
```

- [ ] **Step 3: Re-deploy + browser test** (admin opens Users tab, adds vérificateur, logs out, logs back in as vérificateur, verifies Users tab is hidden and DELETE button absent on videos)

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat(admin): users management view (admin only)"
```

---

## Task 28: Update temoignages.html to fetch /api/public/videos

**Files:**
- Modify: `temoignages.html`

- [ ] **Step 1: Read current `temoignages.html` and locate the `const VIDEOS = [...]` line**

```bash
grep -n "const VIDEOS" temoignages.html
```

- [ ] **Step 2: Replace the inline VIDEOS declaration with a fetch**

Edit `temoignages.html`:

Change:
```js
const VIDEOS = [{"id": ..., ...}, ...];
// (rest of render logic using VIDEOS)
```

To:
```js
let VIDEOS = [];
const API_URL = 'https://tayyibat-admin.<REPLACE_ACCOUNT>.workers.dev/api/public/videos';

async function loadAndRender() {
  try {
    const r = await fetch(API_URL);
    if (!r.ok) throw new Error('fetch failed');
    const j = await r.json();
    VIDEOS = (j.items || []).map(v => ({
      id: v.external_id,
      title: v.title || '(sans titre)',
      url: v.url,
      thumb: v.thumbnail_url,
      dur: v.duration_seconds ? `${Math.floor(v.duration_seconds/60)}:${String(v.duration_seconds%60).padStart(2,'0')}` : ''
    }));
  } catch (e) {
    console.warn('Failed to load videos', e);
    VIDEOS = [];
  }
  renderTestimonials(); // assuming existing render fn; if not, call whatever the existing inline code did
}
loadAndRender();
```

(Adjust to match exactly the existing render function name in `temoignages.html` — check current code first.)

- [ ] **Step 3: Local smoke test**

Open `temoignages.html` in browser, verify the page loads (might be empty if no videos validated yet — that's expected per the spec).

- [ ] **Step 4: Validate one video in admin to populate the public page**

Login admin → /admin.html → open any video → "Marquer validé" → reload /temoignages → confirm it appears.

- [ ] **Step 5: Deploy Pages**

```bash
ARCHIVE_TARGET=$(readlink archive) && rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s "$ARCHIVE_TARGET" archive
```

- [ ] **Step 6: Commit**

```bash
git add temoignages.html
git commit -m "feat(temoignages): fetch validated videos from admin API"
```

---

## Task 29: End-to-end smoke test (manual Playwright)

**Files:** none

- [ ] **Step 1: Open `https://tayyibat.pages.dev/admin.html`** in a clean browser session.

- [ ] **Step 2: Login as `houcemben@gmail.com`** with the `INITIAL_ADMIN_PASSWORD`.

Expected: redirect to videos view, ~185 videos visible all in `pas_valide`.

- [ ] **Step 3: Add a new YouTube video** via the modal:
- URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Expected: appears in list with `pas_valide`, thumbnail loads.

- [ ] **Step 4: Open the new video, mark `valide`, add note "Test E2E".**

Expected: badge turns green, history entry shows "validated".

- [ ] **Step 5: Open `https://tayyibat.pages.dev/temoignages` in a new tab.**

Expected: the validated video appears in the public list. The 185 `pas_valide` ones do NOT appear.

- [ ] **Step 6: Create a vérificateur user** via Users view:
- Email: `verif@test.com`, Nom: `Test V`, Password: `testpw123`

- [ ] **Step 7: Logout, login as vérificateur.**

Expected:
- Users tab hidden in nav.
- Can validate / unvalidate videos.
- Open video detail: NO Delete button.

- [ ] **Step 8: Try via DevTools console:**
```js
fetch('/api/videos/1', { method: 'DELETE', credentials: 'include', headers: { 'X-Requested-With': 'fetch' } }).then(r => console.log(r.status))
```

Expected: `403`.

- [ ] **Step 9: Logout. Test rate limit:** wrong password 6 times → 6th returns 429.

- [ ] **Step 10: Document results in a brief commit message**

```bash
git commit --allow-empty -m "chore: E2E smoke test passed — admin/verificateur workflow validated"
```

---

## Out-of-scope reminders (Phase 2+)

See spec section 11. Notably:
- i18n (FR only at launch)
- Reset password self-service
- 2FA TOTP
- Export CSV
- Bulk operations

---

## Self-Review Notes

1. **Spec coverage** — every section of the spec maps to at least one task:
   - § 3 architecture → tasks 1, 13, 24
   - § 4 schema → task 2
   - § 5 security → tasks 4, 5, 6, 7, 8, 13
   - § 6 platforms → tasks 9, 10, 11, 12
   - § 7 structure → task 1
   - § 8 UI/UX → tasks 23, 24, 25, 26, 27
   - § 9 tests → tasks 4-20 (all TDD), task 29 (E2E)
   - § 10 migration + deploy → tasks 21, 22, 28
2. **Placeholders** — `<REPLACE_ACCOUNT>` in two places (admin.html, temoignages.html); resolved at Tasks 23 step 2 and 28 step 2 after Task 21 prints the actual Worker subdomain.
3. **Type consistency** — `external_id`, `embed_url`, `status` ('valide'/'pas_valide'), `role` ('admin'/'verificateur') used uniformly across all tasks.
