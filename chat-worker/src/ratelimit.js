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
