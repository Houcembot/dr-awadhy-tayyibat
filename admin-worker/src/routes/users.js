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
