const BURST_LIMIT   = 8;    // max 8 req / 60s par IP (anti-spam sans gêner une discussion normale)
const BURST_WINDOW  = 60;
const DAILY_LIMIT   = 50;   // max 50 questions / 24h par IP
const DAY_SECONDS   = 86400;

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

export async function checkRateLimit(kv, ip) {
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
