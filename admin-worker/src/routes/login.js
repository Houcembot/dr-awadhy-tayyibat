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
