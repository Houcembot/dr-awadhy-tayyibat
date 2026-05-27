# Chatbot Tayyibat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chatbot that answers health questions in AR/FR/EN based on Dr Al Awady's teachings, with YouTube video references — deployed on Cloudflare Workers + Cloudflare Pages.

**Architecture:** Cloudflare Worker handles POST /api/chat — filters the 1094-video catalog by keyword, builds a prompt with Dr Al Awady's philosophy, calls Google Gemini 2.0 Flash, returns `{ answer, videos[] }`. The static frontend (chat.html + floating widget) calls the Worker API and renders responses with clickable video cards.

**Tech Stack:** Cloudflare Workers, Google Gemini 2.0 Flash API (free), Cloudflare KV (rate limiting), Vitest (unit tests), Wrangler 4, vanilla JS/HTML (no framework)

---

## File Map

```
tayyibat/
├── chat.html                     ← NEW: dedicated chat page
├── chat-core.js                  ← NEW: shared API + rendering logic
├── chat-widget.js                ← NEW: floating button + overlay
├── index.html                    ← MODIFY: add nav link + widget script
├── videos.html                   ← MODIFY: add nav link + widget script
└── chat-worker/
    ├── src/
    │   ├── index.js              ← NEW: Worker entry point + router
    │   ├── filter.js             ← NEW: keyword filtering of videos
    │   ├── prompt.js             ← NEW: Gemini prompt builder
    │   ├── ratelimit.js          ← NEW: per-IP rate limiting via KV
    │   ├── cors.js               ← NEW: CORS headers helper
    │   └── videos.json           ← COPY from data/videos.json at build
    ├── tests/
    │   ├── filter.test.js        ← NEW: unit tests
    │   ├── prompt.test.js        ← NEW: unit tests
    │   └── ratelimit.test.js     ← NEW: unit tests
    ├── wrangler.toml             ← NEW: Worker config
    └── package.json              ← NEW: vitest + wrangler deps
```

---

## Task 1: Bootstrap the Worker project

**Files:**
- Create: `chat-worker/package.json`
- Create: `chat-worker/wrangler.toml`
- Create: `chat-worker/src/index.js` (skeleton)

- [ ] **Step 1: Create directory structure**

```bash
cd /tmp/tayyibat
mkdir -p chat-worker/src chat-worker/tests
```

- [ ] **Step 2: Create package.json**

```json
// chat-worker/package.json
{
  "name": "tayyibat-chat",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd chat-worker && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Create wrangler.toml**

```toml
# chat-worker/wrangler.toml
name = "tayyibat-chat"
main = "src/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "REPLACE_WITH_KV_ID_AFTER_TASK_7"
preview_id = "REPLACE_WITH_PREVIEW_KV_ID_AFTER_TASK_7"

[build]
command = "cp ../data/videos.json src/videos.json"
```

- [ ] **Step 5: Create skeleton index.js**

```javascript
// chat-worker/src/index.js
export default {
  async fetch(request, env) {
    return new Response('Tayyibat Chat Worker — OK', { status: 200 });
  }
};
```

- [ ] **Step 6: Verify Worker boots**

```bash
cd chat-worker && npm run build 2>/dev/null; cp ../data/videos.json src/videos.json && npx wrangler dev --port 8787 &
sleep 3 && curl http://localhost:8787 && kill %1
```

Expected output: `Tayyibat Chat Worker — OK`

- [ ] **Step 7: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/
git commit -m "feat(chat): bootstrap Cloudflare Worker project"
```

---

## Task 2: Video filtering module

**Files:**
- Create: `chat-worker/src/filter.js`
- Create: `chat-worker/tests/filter.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// chat-worker/tests/filter.test.js
import { describe, it, expect } from 'vitest';
import { filterVideos, tokenize } from '../src/filter.js';

const SAMPLE_VIDEOS = [
  { id: 'v1', title_original: 'السكري والأنسولين', primary_topic: 'diabete-insuline-glycemie', tags: ['سكر', 'insuline'] },
  { id: 'v2', title_original: 'الصداع وعلاجه', primary_topic: 'sommeil-fatigue-stress', tags: ['صداع', 'ارهاق'] },
  { id: 'v3', title_original: 'الكبد والأيض', primary_topic: 'foie-metabolisme', tags: ['كبد'] },
  { id: 'v4', title_original: 'الصيام المتقطع', primary_topic: 'jeune-rythme-poids', tags: ['صيام', 'وزن'] },
];

describe('tokenize', () => {
  it('splits Arabic text into tokens', () => {
    expect(tokenize('السكري والأنسولين')).toEqual(['السكري', 'والأنسولين']);
  });
  it('splits French text into tokens', () => {
    expect(tokenize('diabète insuline')).toEqual(['diabète', 'insuline']);
  });
  it('removes single-character tokens', () => {
    expect(tokenize('a السكر b')).not.toContain('a');
    expect(tokenize('a السكر b')).not.toContain('b');
  });
  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('filterVideos', () => {
  it('returns videos matching topic', () => {
    const results = filterVideos('diabete', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching Arabic title', () => {
    const results = filterVideos('السكري', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
  it('returns videos matching tags', () => {
    const results = filterVideos('صداع', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v2');
  });
  it('respects the limit parameter', () => {
    const results = filterVideos('ا', SAMPLE_VIDEOS, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
  it('returns first N videos when no tokens match', () => {
    const results = filterVideos('zzz', SAMPLE_VIDEOS, 3);
    expect(results.length).toBe(3);
  });
  it('ranks topic match higher than title match', () => {
    // v1 matches topic (3pts) vs hypothetical title-only (2pts)
    const results = filterVideos('insuline', SAMPLE_VIDEOS);
    expect(results[0].id).toBe('v1');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd chat-worker && npm test
```

Expected: `Cannot find module '../src/filter.js'`

- [ ] **Step 3: Implement filter.js**

```javascript
// chat-worker/src/filter.js
export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,،.。،؟?!،;:]+/)
    .filter(t => t.length > 1);
}

export function filterVideos(question, videos, limit = 25) {
  const tokens = tokenize(question);
  if (tokens.length === 0) return videos.slice(0, limit);

  const scored = videos.map(video => ({
    video,
    score: computeScore(tokens, video)
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video }) => video);

  // If fewer than limit matched, pad with unmatched videos
  if (matched.length < limit) {
    const matchedIds = new Set(matched.map(v => v.id));
    const unmatched = videos
      .filter(v => !matchedIds.has(v.id))
      .slice(0, limit - matched.length);
    return [...matched, ...unmatched];
  }
  return matched;
}

function computeScore(tokens, video) {
  const topicText = (video.primary_topic || '').toLowerCase();
  const titleText = (video.title_original || '').toLowerCase();
  const tagsText = (video.tags || []).join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (topicText.includes(token)) score += 3;
    if (titleText.includes(token)) score += 2;
    if (tagsText.includes(token)) score += 1;
  }
  return score;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd chat-worker && npm test
```

Expected: All 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/src/filter.js chat-worker/tests/filter.test.js
git commit -m "feat(chat): add video keyword filtering module with tests"
```

---

## Task 3: Gemini prompt builder

**Files:**
- Create: `chat-worker/src/prompt.js`
- Create: `chat-worker/tests/prompt.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// chat-worker/tests/prompt.test.js
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt.js';

const SAMPLE_VIDEOS = [
  { id: 'v1', title_original: 'السكري والأنسولين', primary_topic: 'diabete-insuline-glycemie', duration_label: '12:34' },
  { id: 'v2', title_original: 'الصيام المتقطع', primary_topic: 'jeune-rythme-poids', duration_label: '8:20' },
];

describe('buildPrompt', () => {
  it('returns an object with system and user keys', () => {
    const result = buildPrompt('ما علاج السكري؟', SAMPLE_VIDEOS);
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
  });
  it('includes the question in the user field', () => {
    const result = buildPrompt('ما علاج السكري؟', SAMPLE_VIDEOS);
    expect(result.user).toBe('ما علاج السكري؟');
  });
  it('includes video IDs in the system prompt', () => {
    const result = buildPrompt('السكري', SAMPLE_VIDEOS);
    expect(result.system).toContain('v1');
    expect(result.system).toContain('v2');
  });
  it('includes video titles in the system prompt', () => {
    const result = buildPrompt('السكري', SAMPLE_VIDEOS);
    expect(result.system).toContain('السكري والأنسولين');
  });
  it('includes JSON output instruction in system prompt', () => {
    const result = buildPrompt('test', SAMPLE_VIDEOS);
    expect(result.system).toContain('video_ids');
    expect(result.system).toContain('answer');
  });
  it('handles empty video list', () => {
    const result = buildPrompt('test', []);
    expect(result.system).toBeDefined();
    expect(result.user).toBe('test');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd chat-worker && npm test
```

Expected: `Cannot find module '../src/prompt.js'`

- [ ] **Step 3: Implement prompt.js**

```javascript
// chat-worker/src/prompt.js
const SYSTEM_BASE = `أنت مساعد الدكتور ضياء العوضي، طبيب مصري متخصص في التغذية العلاجية ومؤسس نظام الطيبات.

فلسفة الدكتور ضياء العوضي:
- 90% من الأمراض المزمنة تبدأ في جهاز هضمي منهك وملتهب
- الطيبات (اللحم الأحمر، الأرز الأبيض، السمن البلدي، زيت الزيتون، العسل) تقلل الحمل الهضمي والالتهاب
- الخبائث (الدقيق الأبيض، الدجاج الصناعي، الحليب ومشتقاته، البقوليات) تزيد الحمل الهضمي
- الصيام المتقطع أداة علاجية تتيح للجسم الإصلاح والتجديد
- التخفيض التدريجي للأدوية ممكن تحت إشراف طبي عندما يتعافى الجسم

قواعد الإجابة:
1. أجب دائماً بنفس لغة السؤال (عربي، فرنسي، أو إنجليزي)
2. كن واضحاً وموجزاً ومتعاطفاً — 3 إلى 5 جمل كحد أقصى
3. اذكر معرفات الفيديوهات المرجعية في حقل video_ids
4. ذكّر دائماً في النهاية أن المحتوى للمعلومات وليس بديلاً عن استشارة طبية
5. أعد JSON صارماً بهذا الشكل فقط:
{"answer": "نص الإجابة هنا", "video_ids": ["id1", "id2"]}`;

export function buildPrompt(question, filteredVideos) {
  const videosSection = filteredVideos.length > 0
    ? filteredVideos.map(v =>
        `ID: ${v.id} | العنوان: ${v.title_original} | الموضوع: ${v.primary_topic} | المدة: ${v.duration_label || '-'}`
      ).join('\n')
    : 'لا توجد فيديوهات متاحة.';

  const system = `${SYSTEM_BASE}\n\nالفيديوهات المتاحة ذات الصلة:\n${videosSection}`;
  return { system, user: question };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd chat-worker && npm test
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/src/prompt.js chat-worker/tests/prompt.test.js
git commit -m "feat(chat): add Gemini prompt builder with tests"
```

---

## Task 4: Rate limiting module

**Files:**
- Create: `chat-worker/src/ratelimit.js`
- Create: `chat-worker/tests/ratelimit.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// chat-worker/tests/ratelimit.test.js
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/ratelimit.js';

function makeMockKV() {
  const store = new Map();
  return {
    async get(key) { return store.get(key) || null; },
    async put(key, value, opts) { store.set(key, value); }
  };
}

describe('checkRateLimit', () => {
  it('allows first request', async () => {
    const kv = makeMockKV();
    expect(await checkRateLimit(kv, '1.2.3.4')).toBe(true);
  });
  it('allows up to 20 requests from same IP', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 20; i++) {
      expect(await checkRateLimit(kv, '1.2.3.4')).toBe(true);
    }
  });
  it('blocks the 21st request from same IP', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 20; i++) await checkRateLimit(kv, '1.2.3.4');
    expect(await checkRateLimit(kv, '1.2.3.4')).toBe(false);
  });
  it('allows different IPs independently', async () => {
    const kv = makeMockKV();
    for (let i = 0; i < 20; i++) await checkRateLimit(kv, '1.2.3.4');
    expect(await checkRateLimit(kv, '5.6.7.8')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd chat-worker && npm test
```

Expected: `Cannot find module '../src/ratelimit.js'`

- [ ] **Step 3: Implement ratelimit.js**

```javascript
// chat-worker/src/ratelimit.js
const LIMIT = 20;
const WINDOW_SECONDS = 60;

export async function checkRateLimit(kv, ip) {
  const windowSlot = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `rl:${ip}:${windowSlot}`;
  const current = parseInt(await kv.get(key) || '0', 10);
  if (current >= LIMIT) return false;
  await kv.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return true;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd chat-worker && npm test
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/src/ratelimit.js chat-worker/tests/ratelimit.test.js
git commit -m "feat(chat): add per-IP rate limiting module with tests"
```

---

## Task 5: CORS helper

**Files:**
- Create: `chat-worker/src/cors.js`

*(No separate test file — tested implicitly via Worker integration in Task 6)*

- [ ] **Step 1: Create cors.js**

```javascript
// chat-worker/src/cors.js
const ALLOWED_ORIGIN = 'https://tayyibat.pages.dev';

export function corsHeaders(request) {
  const origin = request?.headers?.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function handlePreflight(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/src/cors.js
git commit -m "feat(chat): add CORS helper for tayyibat.pages.dev"
```

---

## Task 6: Main Worker router

**Files:**
- Modify: `chat-worker/src/index.js`

- [ ] **Step 1: Copy videos.json into Worker source**

```bash
cp /tmp/tayyibat/data/videos.json /tmp/tayyibat/chat-worker/src/videos.json
```

Add to `.gitignore` in chat-worker (it's generated at build time):

```bash
echo "src/videos.json" >> /tmp/tayyibat/chat-worker/.gitignore
```

- [ ] **Step 2: Write the complete index.js**

```javascript
// chat-worker/src/index.js
import { filterVideos } from './filter.js';
import { buildPrompt } from './prompt.js';
import { checkRateLimit } from './ratelimit.js';
import { corsHeaders, handlePreflight } from './cors.js';
import videosData from './videos.json';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const videoMap = new Map(videosData.map(v => [v.id, v]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return handlePreflight(request);
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      return new Response('Not found', { status: 404 });
    }

    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const allowed = await checkRateLimit(env.RATE_LIMIT_KV, ip);
    if (!allowed) {
      return Response.json(
        { error: 'rate_limit' },
        { status: 429, headers: corsHeaders(request) }
      );
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'invalid_json' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const question = String(body.question || '').trim();
    if (!question || question.length > 500) {
      return Response.json(
        { error: 'missing_question' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Build prompt
    const filtered = filterVideos(question, videosData, 25);
    const { system, user } = buildPrompt(question, filtered);

    // Call Gemini
    let geminiData;
    try {
      const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 1024,
            temperature: 0.3
          }
        })
      });
      if (!geminiRes.ok) throw new Error(`Gemini ${geminiRes.status}`);
      geminiData = await geminiRes.json();
    } catch (err) {
      console.error('Gemini error:', err);
      return Response.json(
        { error: 'model_error' },
        { status: 502, headers: corsHeaders(request) }
      );
    }

    // Parse Gemini response
    let parsed;
    try {
      const text = geminiData.candidates[0].content.parts[0].text;
      parsed = JSON.parse(text);
    } catch {
      return Response.json(
        { error: 'model_error' },
        { status: 502, headers: corsHeaders(request) }
      );
    }

    // Resolve video_ids to full objects
    const videos = (parsed.video_ids || [])
      .map(id => videoMap.get(id))
      .filter(Boolean)
      .slice(0, 5)
      .map(v => ({
        id: v.id,
        title: v.title_original,
        url: v.source_url,
        duration: v.duration_label || '-',
        topic: v.primary_topic
      }));

    return Response.json(
      { answer: parsed.answer || '', videos },
      { headers: corsHeaders(request) }
    );
  }
};
```

- [ ] **Step 3: Run all unit tests to confirm nothing is broken**

```bash
cd chat-worker && npm test
```

Expected: All 20 tests pass (filter + prompt + ratelimit).

- [ ] **Step 4: Start Worker locally and test with curl**

```bash
cd chat-worker && cp ../data/videos.json src/videos.json
GEMINI_API_KEY=<your_key> npx wrangler dev --port 8787 &
sleep 3

curl -s -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"ما علاج السكري؟"}' | python3 -m json.tool

kill %1
```

Expected: JSON with `answer` string and `videos` array (even in local mode without KV, rate limit skips if env.RATE_LIMIT_KV is undefined — add fallback if needed).

- [ ] **Step 5: Commit**

```bash
cd /tmp/tayyibat
git add chat-worker/src/index.js chat-worker/.gitignore
git commit -m "feat(chat): complete Worker router with Gemini integration"
```

---

## Task 7: Deploy the Worker to Cloudflare

- [ ] **Step 1: Create KV namespaces**

```bash
cd chat-worker
npx wrangler kv namespace create RATE_LIMIT_KV
# → Copy the id printed to wrangler.toml "id" field

npx wrangler kv namespace create RATE_LIMIT_KV --preview
# → Copy the preview_id to wrangler.toml "preview_id" field
```

- [ ] **Step 2: Update wrangler.toml with real KV IDs**

Replace `REPLACE_WITH_KV_ID_AFTER_TASK_7` and `REPLACE_WITH_PREVIEW_KV_ID_AFTER_TASK_7` in `wrangler.toml` with the IDs from Step 1.

- [ ] **Step 3: Set the Gemini API key secret**

Get a free key at: https://aistudio.google.com/app/apikey

```bash
cd chat-worker
npx wrangler secret put GEMINI_API_KEY
# → Paste your key when prompted
```

- [ ] **Step 4: Deploy the Worker**

```bash
cd chat-worker
cp ../data/videos.json src/videos.json
npx wrangler deploy
```

Expected output includes: `Published tayyibat-chat` with a `workers.dev` URL like `https://tayyibat-chat.<account>.workers.dev`

- [ ] **Step 5: Test the live Worker**

```bash
curl -s -X POST https://tayyibat-chat.<account>.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"ما علاج السكري؟"}' | python3 -m json.tool
```

Expected: `{ "answer": "...", "videos": [...] }` with real YouTube links.

```bash
# Test rate limit (run 21 times quickly)
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://tayyibat-chat.<account>.workers.dev/api/chat \
    -H "Content-Type: application/json" -d '{"question":"test"}'
done
# Expected: first 20 → 200, 21st → 429
```

- [ ] **Step 6: Note the Worker URL**

Save the deployed URL (e.g. `https://tayyibat-chat.<account>.workers.dev`) — needed in Tasks 8 and 9.

- [ ] **Step 7: Commit wrangler.toml with real KV IDs**

```bash
cd /tmp/tayyibat
git add chat-worker/wrangler.toml
git commit -m "feat(chat): configure KV namespaces for rate limiting"
```

---

## Task 8: chat.html — Dedicated chat page

**Files:**
- Create: `chat-core.js`
- Create: `chat.html`

- [ ] **Step 1: Create chat-core.js (shared API + rendering)**

Replace `WORKER_URL` with the actual Worker URL from Task 7.

```javascript
// chat-core.js
const WORKER_URL = 'https://tayyibat-chat.<account>.workers.dev/api/chat';

const I18N = {
  fr: {
    placeholder: 'Posez votre question de santé...',
    send: 'Envoyer',
    welcome: 'Bonjour ! Je suis l\'assistant du Système Tayyibat. Posez-moi une question sur votre santé.',
    source: 'Voir la vidéo',
    disclaimer: '⚠ Ces informations sont éducatives et ne remplacent pas un avis médical.',
    error_rate: 'Trop de questions. Réessayez dans une minute.',
    error_model: 'Erreur du modèle. Réessayez.',
    error_generic: 'Une erreur est survenue.',
    thinking: 'En cours...'
  },
  en: {
    placeholder: 'Ask your health question...',
    send: 'Send',
    welcome: 'Hello! I am the Tayyibat System assistant. Ask me a health question.',
    source: 'Watch video',
    disclaimer: '⚠ This information is educational and does not replace medical advice.',
    error_rate: 'Too many requests. Try again in a minute.',
    error_model: 'Model error. Please try again.',
    error_generic: 'An error occurred.',
    thinking: 'Thinking...'
  },
  ar: {
    placeholder: 'اكتب سؤالك الصحي...',
    send: 'إرسال',
    welcome: 'مرحباً! أنا مساعد نظام الطيبات. اسألني عن صحتك.',
    source: 'شاهد الفيديو',
    disclaimer: '⚠ هذه المعلومات تعليمية ولا تغني عن استشارة طبيب متخصص.',
    error_rate: 'طلبات كثيرة جداً. حاول مرة أخرى بعد دقيقة.',
    error_model: 'خطأ في النموذج. حاول مرة أخرى.',
    error_generic: 'حدث خطأ ما.',
    thinking: 'جاري التفكير...'
  }
};

export function getLang() {
  return localStorage.getItem('lang') || 'fr';
}

export function t(key) {
  const lang = getLang();
  return (I18N[lang] || I18N.fr)[key] || key;
}

export function createMessageEl(role, content) {
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.innerHTML = content;
  return div;
}

export function createVideoCard(video) {
  const card = document.createElement('a');
  card.className = 'chat-video-card';
  card.href = video.url;
  card.target = '_blank';
  card.rel = 'noopener';
  card.innerHTML = `
    <span class="chat-video-title" dir="rtl">${escapeHtml(video.title)}</span>
    <span class="chat-video-meta">${escapeHtml(video.duration)} · ${t('source')}</span>
  `;
  return card;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

export async function sendQuestion(question, messagesEl) {
  const lang = getLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  // User bubble
  messagesEl.appendChild(createMessageEl('user', `<span dir="${dir}">${escapeHtml(question)}</span>`));

  // Thinking indicator
  const thinking = createMessageEl('bot', `<em>${t('thinking')}</em>`);
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let data;
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, lang })
    });
    data = await res.json();
  } catch {
    thinking.innerHTML = `<span class="chat-error">${t('error_generic')}</span>`;
    return;
  }

  if (data.error === 'rate_limit') {
    thinking.innerHTML = `<span class="chat-error">${t('error_rate')}</span>`;
    return;
  }
  if (data.error) {
    thinking.innerHTML = `<span class="chat-error">${t('error_model')}</span>`;
    return;
  }

  // Bot answer
  thinking.innerHTML = `<span dir="${dir}">${escapeHtml(data.answer)}</span>
    <p class="chat-disclaimer">${t('disclaimer')}</p>`;

  // Video cards
  if (data.videos && data.videos.length > 0) {
    const cardsRow = document.createElement('div');
    cardsRow.className = 'chat-video-row';
    data.videos.forEach(v => cardsRow.appendChild(createVideoCard(v)));
    messagesEl.appendChild(cardsRow);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}
```

- [ ] **Step 2: Create chat.html**

```html
<!-- chat.html -->
<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chat — Dr Dhiaa Al Awadhy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Playfair+Display:wght@600;800&family=Source+Sans+3:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --gold: #C9A84C; --gold-soft: #E6D18A; --dark: #1A1A18;
    --ink: #24231F; --muted: #706D61; --cream: #F5F0E8;
    --paper: #FFFCF4; --green: #2D6A4F; --line: rgba(26,26,24,0.12);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--cream); color: var(--ink);
         font-family: "Source Sans 3", sans-serif; line-height: 1.55; }
  [lang="ar"] body, [lang="ar"] .brand, [lang="ar"] .navlinks a,
  [lang="ar"] .chat-msg, [lang="ar"] .chat-input { font-family: "Cairo", sans-serif; }
  a { color: inherit; }

  /* TOPBAR */
  .topbar { position: sticky; top: 0; z-index: 10;
            background: rgba(26,26,24,0.96);
            border-bottom: 1px solid rgba(201,168,76,0.35); color: var(--cream); }
  .topbar-inner { max-width: 1180px; margin: 0 auto;
                  padding: 14px clamp(18px,4vw,36px);
                  display: flex; align-items: center;
                  justify-content: space-between; gap: 18px; }
  .brand { font-family: "Playfair Display", serif; font-weight: 800;
           color: var(--gold-soft); text-decoration: none; white-space: nowrap; }
  [lang="ar"] .brand { font-family: "Cairo", sans-serif; }
  .navlinks { display: flex; gap: 18px; align-items: center;
              flex-wrap: wrap; justify-content: flex-end; }
  .navlinks a { color: rgba(245,240,232,0.75); font-size: 13px;
                letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; }
  .navlinks a:hover { color: var(--gold-soft); }
  .lang-switcher { display: flex; gap: 2px; margin-left: 12px; }
  [dir="rtl"] .lang-switcher { margin-left: 0; margin-right: 12px; }
  .lang-btn { background: transparent; border: 1px solid transparent;
               color: rgba(245,240,232,0.45); font-size: 11px; padding: 5px 9px;
               cursor: pointer; text-transform: uppercase; border-radius: 2px;
               line-height: 1; font-family: inherit; }
  .lang-btn:hover { color: var(--gold-soft); }
  .lang-btn.active { color: var(--gold-soft); border-color: rgba(201,168,76,0.4);
                     background: rgba(201,168,76,0.1); }

  /* CHAT LAYOUT */
  .chat-page { max-width: 780px; margin: 0 auto;
               padding: 36px clamp(18px,4vw,36px) 80px;
               display: flex; flex-direction: column; height: calc(100vh - 60px); }
  .chat-messages { flex: 1; overflow-y: auto; display: flex;
                   flex-direction: column; gap: 14px; padding-bottom: 12px; }
  .chat-msg { max-width: 80%; padding: 12px 16px;
              font-size: 0.97rem; line-height: 1.6; }
  .chat-msg--user { align-self: flex-end; background: var(--dark);
                    color: var(--cream); border-radius: 2px; }
  .chat-msg--bot { align-self: flex-start; background: var(--paper);
                   border: 1px solid var(--line); border-radius: 2px; }
  .chat-disclaimer { font-size: 0.82rem; color: var(--muted); margin: 8px 0 0; }
  .chat-error { color: #9B2335; }
  .chat-video-row { display: flex; gap: 10px; flex-wrap: wrap; padding: 0 0 4px; }
  .chat-video-card { display: block; background: var(--paper);
                     border: 1px solid var(--line); padding: 10px 14px;
                     text-decoration: none; color: var(--ink); min-width: 180px;
                     max-width: 220px; flex-shrink: 0; }
  .chat-video-card:hover { border-color: var(--gold); }
  .chat-video-title { display: block; font-family: "Cairo", sans-serif;
                      font-weight: 700; font-size: 0.9rem; line-height: 1.4; }
  .chat-video-meta { display: block; font-size: 0.78rem; color: var(--muted);
                     margin-top: 4px; text-transform: uppercase; letter-spacing: 0.08em; }

  /* CHAT INPUT */
  .chat-form { display: flex; gap: 10px; border-top: 1px solid var(--line);
               padding-top: 14px; margin-top: 14px; }
  .chat-input { flex: 1; min-height: 48px; border: 1px solid var(--dark);
                background: var(--paper); color: var(--ink); font: inherit;
                font-size: 1rem; padding: 12px 14px; outline: none; resize: none; }
  .chat-input:focus { box-shadow: 0 0 0 3px rgba(201,168,76,0.28); }
  .chat-send { background: var(--dark); color: var(--gold-soft);
               border: none; padding: 12px 20px; cursor: pointer;
               font: inherit; font-size: 0.9rem; font-weight: 700;
               letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
  .chat-send:hover { background: #2c2c28; }

  @media (max-width: 620px) {
    .topbar-inner { flex-direction: column; align-items: flex-start; }
    .navlinks { justify-content: flex-start; }
    .chat-msg { max-width: 95%; }
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="index.html" data-i18n="brand">Le Système Tayyibat</a>
    <nav class="navlinks">
      <a href="index.html" data-i18n="nav_home">Accueil</a>
      <a href="videos.html" data-i18n="nav_videos">Vidéos</a>
      <a href="chat.html" data-i18n="nav_chat">Chat</a>
      <div class="lang-switcher">
        <button class="lang-btn active" data-lang="fr">FR</button>
        <button class="lang-btn" data-lang="en">EN</button>
        <button class="lang-btn" data-lang="ar">AR</button>
      </div>
    </nav>
  </div>
</header>

<main class="chat-page">
  <div class="chat-messages" id="messages"></div>
  <form class="chat-form" id="form">
    <textarea class="chat-input" id="input" rows="1"
              placeholder="Posez votre question de santé..."></textarea>
    <button class="chat-send" type="submit" id="send-btn">Envoyer</button>
  </form>
</main>

<script type="module">
import { sendQuestion, t, getLang } from './chat-core.js';

const I18N_PAGE = {
  fr: { brand: 'Le Système Tayyibat', nav_home: 'Accueil', nav_videos: 'Vidéos', nav_chat: 'Chat',
        meta_title: 'Chat — Dr Dhiaa Al Awadhy' },
  en: { brand: 'The Tayyibat System', nav_home: 'Home', nav_videos: 'Videos', nav_chat: 'Chat',
        meta_title: 'Chat — Dr Dhiaa Al Awadhy' },
  ar: { brand: 'نظام الطيبات', nav_home: 'الرئيسية', nav_videos: 'الفيديوهات', nav_chat: 'المحادثة',
        meta_title: 'المحادثة — د. ضياء العوضي' }
};

function applyLang(lang) {
  const tr = I18N_PAGE[lang] || I18N_PAGE.fr;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = tr.meta_title;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = tr[el.dataset.i18n];
    if (val) el.textContent = val;
  });
  document.getElementById('input').placeholder = t('placeholder');
  document.getElementById('send-btn').textContent = t('send');
  document.querySelectorAll('.lang-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.lang === lang));
  localStorage.setItem('lang', lang);
}

function init() {
  const lang = getLang();
  applyLang(lang);

  // Welcome message
  const msgs = document.getElementById('messages');
  const welcome = document.createElement('div');
  welcome.className = 'chat-msg chat-msg--bot';
  welcome.textContent = t('welcome');
  msgs.appendChild(welcome);

  document.querySelectorAll('.lang-btn').forEach(btn =>
    btn.addEventListener('click', () => applyLang(btn.dataset.lang)));

  document.getElementById('form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    input.style.height = '';
    await sendQuestion(question, msgs);
  });

  // Auto-resize textarea
  document.getElementById('input').addEventListener('input', function() {
    this.style.height = '';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
}

init();
</script>
</body>
</html>
```

- [ ] **Step 3: Test chat.html locally**

Open `chat.html` directly in a browser (via a local server):

```bash
cd /tmp/tayyibat && python3 -m http.server 3000
```

Navigate to `http://localhost:3000/chat.html`. Verify:
- Welcome message appears in correct language
- Lang switcher updates all text + RTL on Arabic
- Typing a question and submitting calls the Worker and shows a response + video cards

- [ ] **Step 4: Commit**

```bash
cd /tmp/tayyibat
git add chat.html chat-core.js
git commit -m "feat(chat): add chat page and shared chat-core module"
```

---

## Task 9: Floating chat widget

**Files:**
- Create: `chat-widget.js`

- [ ] **Step 1: Create chat-widget.js**

```javascript
// chat-widget.js
import { sendQuestion, t, getLang } from './chat-core.js';

const WIDGET_CSS = `
  .cw-btn { position: fixed; bottom: 24px; right: 24px; width: 52px; height: 52px;
             border-radius: 50%; background: #1A1A18; border: 2px solid #C9A84C;
             cursor: pointer; display: flex; align-items: center; justify-content: center;
             z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  [dir="rtl"] .cw-btn { right: auto; left: 24px; }
  .cw-btn svg { width: 24px; height: 24px; fill: #E6D18A; }
  .cw-overlay { position: fixed; bottom: 88px; right: 24px; width: 360px; max-height: 520px;
                background: #F5F0E8; border: 1px solid rgba(26,26,24,0.12);
                box-shadow: 0 8px 32px rgba(0,0,0,0.2); display: none;
                flex-direction: column; z-index: 9998; }
  [dir="rtl"] .cw-overlay { right: auto; left: 24px; }
  .cw-overlay.open { display: flex; }
  .cw-header { background: #1A1A18; color: #E6D18A; padding: 12px 16px;
               font-size: 0.9rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .cw-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex;
                 flex-direction: column; gap: 10px; }
  .cw-msg { padding: 10px 12px; font-size: 0.9rem; line-height: 1.55; max-width: 90%; }
  .cw-msg--user { align-self: flex-end; background: #1A1A18; color: #F5F0E8; }
  .cw-msg--bot { align-self: flex-start; background: #FFFCF4;
                 border: 1px solid rgba(26,26,24,0.12); }
  .cw-disclaimer { font-size: 0.75rem; color: #706D61; margin: 6px 0 0; }
  .cw-error { color: #9B2335; }
  .cw-video-card { display: block; background: #FFFCF4; border: 1px solid rgba(26,26,24,0.12);
                   padding: 7px 10px; text-decoration: none; color: #24231F; margin-top: 4px; }
  .cw-video-card:hover { border-color: #C9A84C; }
  .cw-video-title { display: block; font-family: Cairo, sans-serif; font-weight: 700;
                    font-size: 0.82rem; line-height: 1.4; direction: rtl; }
  .cw-video-meta { display: block; font-size: 0.72rem; color: #706D61; margin-top: 2px; }
  .cw-form { display: flex; border-top: 1px solid rgba(26,26,24,0.12); }
  .cw-input { flex: 1; border: none; background: #FFFCF4; padding: 10px 12px;
              font: inherit; font-size: 0.9rem; outline: none; color: #24231F; }
  .cw-send { background: #1A1A18; color: #E6D18A; border: none; padding: 10px 14px;
             cursor: pointer; font: inherit; font-size: 0.8rem; font-weight: 700;
             letter-spacing: 0.1em; text-transform: uppercase; }
`;

function injectCSS(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

function buildWidget() {
  injectCSS(WIDGET_CSS);

  const btn = document.createElement('button');
  btn.className = 'cw-btn';
  btn.setAttribute('aria-label', 'Chat');
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 00-2 2v12a2 2 0 002 2h14l4 4V4a2 2 0 00-2-2z"/></svg>`;

  const overlay = document.createElement('div');
  overlay.className = 'cw-overlay';
  overlay.innerHTML = `
    <div class="cw-header">Dr Dhiaa Al Awadhy</div>
    <div class="cw-messages" id="cw-msgs"></div>
    <form class="cw-form" id="cw-form">
      <input class="cw-input" id="cw-input" type="text" placeholder="${t('placeholder')}" autocomplete="off">
      <button class="cw-send" type="submit">${t('send')}</button>
    </form>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  // Welcome message
  const msgs = overlay.querySelector('#cw-msgs');
  const welcome = document.createElement('div');
  welcome.className = 'cw-msg cw-msg--bot';
  welcome.textContent = t('welcome');
  msgs.appendChild(welcome);

  btn.addEventListener('click', () => overlay.classList.toggle('open'));

  overlay.querySelector('#cw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = overlay.querySelector('#cw-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';

    // Adapt sendQuestion output to widget CSS classes
    const lang = getLang();
    const dir = lang === 'ar' ? 'rtl' : 'ltr';

    const userMsg = document.createElement('div');
    userMsg.className = 'cw-msg cw-msg--user';
    userMsg.innerHTML = `<span dir="${dir}">${escapeHtml(question)}</span>`;
    msgs.appendChild(userMsg);

    const botMsg = document.createElement('div');
    botMsg.className = 'cw-msg cw-msg--bot';
    botMsg.innerHTML = `<em>${t('thinking')}</em>`;
    msgs.appendChild(botMsg);
    msgs.scrollTop = msgs.scrollHeight;

    let data;
    try {
      const res = await fetch(/* WORKER_URL from chat-core */ '', { method: 'GET' }); // placeholder
      // Import WORKER_URL from chat-core — see note below
    } catch {}
    // NOTE: reuse the fetch logic from chat-core.js by importing sendQuestion
    // but with a custom messages container. For simplicity, duplicate the fetch call here
    // using the same WORKER_URL constant. At Task 9 implementation time, export WORKER_URL
    // from chat-core.js and import it here.
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildWidget);
} else {
  buildWidget();
}
```

**Important:** In the form submit handler above, export `WORKER_URL` from `chat-core.js` and import it in `chat-widget.js`. Also export a `fetchChat(question, lang)` function from `chat-core.js` to avoid duplicating the fetch logic. Update `chat-core.js`:

```javascript
// Add to chat-core.js exports:
export const WORKER_URL = 'https://tayyibat-chat.<account>.workers.dev/api/chat';

export async function fetchChat(question, lang) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, lang })
  });
  return res.json();
}
```

Then use `fetchChat` in both `chat-core.js`'s `sendQuestion` and `chat-widget.js`'s form handler.

- [ ] **Step 2: Complete the widget form handler using fetchChat**

Replace the placeholder form handler in chat-widget.js with:

```javascript
overlay.querySelector('#cw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = overlay.querySelector('#cw-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  const lang = getLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const userMsg = document.createElement('div');
  userMsg.className = 'cw-msg cw-msg--user';
  userMsg.innerHTML = `<span dir="${dir}">${escapeHtml(question)}</span>`;
  msgs.appendChild(userMsg);

  const botMsg = document.createElement('div');
  botMsg.className = 'cw-msg cw-msg--bot';
  botMsg.innerHTML = `<em>${t('thinking')}</em>`;
  msgs.appendChild(botMsg);
  msgs.scrollTop = msgs.scrollHeight;

  let data;
  try {
    data = await fetchChat(question, lang);
  } catch {
    botMsg.innerHTML = `<span class="cw-error">${t('error_generic')}</span>`;
    return;
  }

  if (data.error === 'rate_limit') { botMsg.innerHTML = `<span class="cw-error">${t('error_rate')}</span>`; return; }
  if (data.error) { botMsg.innerHTML = `<span class="cw-error">${t('error_model')}</span>`; return; }

  botMsg.innerHTML = `<span dir="${dir}">${escapeHtml(data.answer)}</span>
    <p class="cw-disclaimer">${t('disclaimer')}</p>`;

  (data.videos || []).forEach(v => {
    const card = document.createElement('a');
    card.className = 'cw-video-card';
    card.href = v.url;
    card.target = '_blank';
    card.rel = 'noopener';
    card.innerHTML = `<span class="cw-video-title">${escapeHtml(v.title)}</span>
      <span class="cw-video-meta">${escapeHtml(v.duration)} · ${t('source')}</span>`;
    msgs.appendChild(card);
  });
  msgs.scrollTop = msgs.scrollHeight;
});
```

- [ ] **Step 3: Test widget locally**

Navigate to `http://localhost:3000/index.html`. Verify:
- Chat button appears bottom-right (bottom-left in Arabic)
- Opens/closes on click
- Welcome message shows
- Question + answer flow works

- [ ] **Step 4: Commit**

```bash
cd /tmp/tayyibat
git add chat-widget.js chat-core.js
git commit -m "feat(chat): add floating chat widget for all pages"
```

---

## Task 10: Update index.html and videos.html

**Files:**
- Modify: `index.html` (add Chat nav link + widget script)
- Modify: `videos.html` (add Chat nav link + widget script)

- [ ] **Step 1: Update videos.html nav — add Chat link**

In `videos.html`, in the `<nav class="navlinks">` block, add after "Sources":

```html
<a href="chat.html" data-i18n="nav_chat">Chat</a>
```

Also add to the `i18n` object in videos.html's `<script>`:
```javascript
// In each lang object, add:
// fr:  nav_chat: "Chat"
// en:  nav_chat: "Chat"
// ar:  nav_chat: "المحادثة"
```

- [ ] **Step 2: Add widget script to videos.html**

Before `</body>` in videos.html, add:

```html
<script type="module" src="chat-widget.js"></script>
```

- [ ] **Step 3: Update index.html**

Find the nav section in index.html (look for `data-i18n="nav_references"` around line 413) and add after it:

```html
<a href="chat.html" data-i18n="nav_chat">Chat</a>
```

Add `nav_chat` translations to the `i18n` object in index.html's `<script>`:
```javascript
// fr: nav_chat: "Chat"
// en: nav_chat: "Chat"  
// ar: nav_chat: "المحادثة"
```

Add widget script before `</body>` in index.html:

```html
<script type="module" src="chat-widget.js"></script>
```

- [ ] **Step 4: Test all three pages locally**

```bash
cd /tmp/tayyibat && python3 -m http.server 3000
```

Check `http://localhost:3000/`, `http://localhost:3000/videos.html`, `http://localhost:3000/chat.html`:
- Chat link appears in nav on all pages
- Widget button appears on index.html and videos.html
- Lang switcher applies on all pages without breaking

- [ ] **Step 5: Commit**

```bash
cd /tmp/tayyibat
git add index.html videos.html
git commit -m "feat(chat): add Chat nav link and floating widget to all pages"
```

---

## Task 11: Deploy and end-to-end test

- [ ] **Step 1: Update Worker URL in chat-core.js**

Verify `WORKER_URL` in `chat-core.js` matches the actual deployed Worker URL from Task 7.

- [ ] **Step 2: Deploy site via Wrangler**

```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
# Sync changes from /tmp/tayyibat
cp /tmp/tayyibat/chat.html .
cp /tmp/tayyibat/chat-core.js .
cp /tmp/tayyibat/chat-widget.js .
cp /tmp/tayyibat/index.html .
cp /tmp/tayyibat/videos.html .

npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true
```

- [ ] **Step 3: End-to-end test on live site**

Open `https://tayyibat.pages.dev/chat` in a browser. Test:

1. **Arabic:** Type `ما علاج السكري؟` → verify Arabic response + video cards with YouTube links
2. **French:** Switch to FR, type `comment traiter le diabète ?` → verify French response
3. **English:** Switch to EN, type `what does the doctor say about digestion?` → verify English response
4. **Widget:** Go to `/videos`, click widget button → chat opens and works
5. **Rate limit:** Send 21 rapid requests → 21st should show rate limit message

- [ ] **Step 4: Final commit + push**

```bash
cd /tmp/tayyibat
git add -A
git commit -m "feat(chat): complete chatbot Tayyibat Phase C — deploy ready"
git push origin main
```

---

## Transition to Phase A

When Codex has generated transcripts (Arabic text per video), replace the keyword filtering in `filter.js` with a Cloudflare Vectorize lookup:

1. Generate embeddings for each transcript chunk via Cloudflare Workers AI (`@cf/baai/bge-small-en-v1.5`)
2. Store chunks + embeddings in Cloudflare Vectorize index
3. At query time: embed the question → vector search top 25 chunks → build prompt with chunks instead of video titles
4. The Worker API contract stays identical → zero frontend changes
