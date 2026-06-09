const EMAIL_THRESHOLD = 5;
const IP_THRESHOLD = 20;
const WINDOW_SECONDS = 15 * 60;
const BLOCK_SECONDS = 30 * 60;

const emailKey = (email) => `login:email:${email.toLowerCase()}`;
const ipKey = (ip) => `login:ip:${ip}`;

async function bump(kv, key, threshold) {
  const cur = parseInt((await kv.get(key)) || '0', 10);
  const next = cur + 1;
  const ttl = next >= threshold ? BLOCK_SECONDS : WINDOW_SECONDS;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
}

export async function recordLoginFailure(kv, email, ip) {
  await bump(kv, emailKey(email), EMAIL_THRESHOLD);
  await bump(kv, ipKey(ip), IP_THRESHOLD);
}

export async function isLoginBlocked(kv, email, ip) {
  const e = parseInt((await kv.get(emailKey(email))) || '0', 10);
  if (e >= EMAIL_THRESHOLD) return true;
  const i = parseInt((await kv.get(ipKey(ip))) || '0', 10);
  if (i >= IP_THRESHOLD) return true;
  return false;
}

export async function clearLoginFailures(kv, email) {
  await kv.delete(emailKey(email));
}
