const BURST_LIMIT   = 8;    // max 8 req / 60s par IP (anti-spam sans gêner une discussion normale)
const BURST_WINDOW  = 60;
const DAILY_LIMIT   = 500;  // temporairement élevé pour les tests
const DAY_SECONDS   = 86400;

// Limites relâchées pour /api/chat_v2 (pas de LLM, coût quasi nul)
const V2_BURST_LIMIT  = 30;   // 30 req / 60s / IP
const V2_DAILY_LIMIT  = 100;  // 100 req / jour / IP

// Admin bypass — la règle s'applique aux invités seulement, pas à l'admin.
// Ajouter ici les IPs des admins, ou utiliser le token via header X-Admin-Token
// ou query param ?admin=<token>.
const ADMIN_IPS = new Set([
  '196.176.114.3',   // houcemben — dev IP
]);
const ADMIN_TOKEN = 'drdia-admin-2026-hb';

export function isAdmin(ip, request) {
  if (ip && ADMIN_IPS.has(ip)) return true;
  if (!request) return false;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('admin') === ADMIN_TOKEN) return true;
  } catch {}
  const hdr = request.headers && request.headers.get && request.headers.get('X-Admin-Token');
  if (hdr === ADMIN_TOKEN) return true;
  return false;
}

function parseDaily(raw, now) {
  if (!raw) return { count: 0, resetAt: now + DAY_SECONDS };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.count) && Number.isFinite(parsed.resetAt)) return parsed;
  } catch {
    const count = parseInt(raw, 10);
    if (Number.isFinite(count)) return { count, resetAt: now + DAY_SECONDS };
  }
  return { count: 0, resetAt: now + DAY_SECONDS };
}

export async function checkRateLimitV2(kv, ip, request) {
  if (isAdmin(ip, request)) return { allowed: true, admin: true };
  const now      = Math.floor(Date.now() / 1000);
  const burstSlot = Math.floor(now / BURST_WINDOW);
  const burstKey  = `rl2:${ip}:${burstSlot}`;
  const burst     = parseInt(await kv.get(burstKey) || '0', 10);
  if (burst >= V2_BURST_LIMIT) {
    return { allowed: false, reason: 'burst' };
  }
  const dailyKey = `dl2:${ip}`;
  const daily    = parseDaily(await kv.get(dailyKey), now);
  if (daily.resetAt <= now) { daily.count = 0; daily.resetAt = now + DAY_SECONDS; }
  if (daily.count >= V2_DAILY_LIMIT) {
    return { allowed: false, reason: 'daily' };
  }
  await kv.put(burstKey, String(burst + 1), { expirationTtl: BURST_WINDOW * 2 });
  await kv.put(dailyKey, JSON.stringify({ count: daily.count + 1, resetAt: daily.resetAt }), {
    expirationTtl: Math.max(60, daily.resetAt - now),
  });
  return { allowed: true };
}

export async function checkRateLimit(kv, ip, request) {
  if (isAdmin(ip, request)) {
    return { allowed: true, admin: true, usage: { used: 0, remaining: DAILY_LIMIT, limit: DAILY_LIMIT, resetAt: 0 } };
  }
  const now = Math.floor(Date.now() / 1000);

  // 1. Burst check (anti-spam)
  const burstSlot = Math.floor(now / BURST_WINDOW);
  const burstKey  = `rl:${ip}:${burstSlot}`;
  const burst     = parseInt(await kv.get(burstKey) || '0', 10);
  if (burst >= BURST_LIMIT) {
    return {
      allowed: false,
      reason: 'burst',
      usage: { used: 0, remaining: 0, limit: DAILY_LIMIT, resetAt: now + BURST_WINDOW },
    };
  }

  // 2. Daily check (50 questions / 24h rolling window)
  const dailyKey = `dl:${ip}`;
  const daily    = parseDaily(await kv.get(dailyKey), now);
  if (daily.resetAt <= now) {
    daily.count = 0;
    daily.resetAt = now + DAY_SECONDS;
  }
  if (daily.count >= DAILY_LIMIT) {
    return {
      allowed: false,
      reason: 'daily',
      usage: { used: daily.count, remaining: 0, limit: DAILY_LIMIT, resetAt: daily.resetAt },
    };
  }

  // Increment both counters
  const nextCount = daily.count + 1;
  await kv.put(burstKey, String(burst + 1), { expirationTtl: BURST_WINDOW * 2 });
  await kv.put(dailyKey, JSON.stringify({ count: nextCount, resetAt: daily.resetAt }), {
    expirationTtl: Math.max(60, daily.resetAt - now),
  });
  return {
    allowed: true,
    usage: { used: nextCount, remaining: DAILY_LIMIT - nextCount, limit: DAILY_LIMIT, resetAt: daily.resetAt },
  };
}
