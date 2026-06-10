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
