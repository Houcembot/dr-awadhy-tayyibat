import { requireAuth } from '../auth.js';

const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function extractYouTubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (YT_ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if (/youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|embed)\/([^/]+)/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

export async function listWhitelist(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin', 'verificateur']);
  if (auth.error) return auth.error;
  const rows = await env.ADMIN_DB.prepare(
    `SELECT w.external_id, w.title, w.added_at, u.email AS added_by_email
     FROM video_whitelist w LEFT JOIN users u ON u.id = w.added_by
     ORDER BY w.added_at DESC`
  ).all();
  return new Response(JSON.stringify({ items: rows.results, total: rows.results.length }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function addWhitelist(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const external_id = extractYouTubeId(body.url || body.external_id || '');
  if (!external_id) return new Response('Invalid YouTube URL or ID', { status: 400 });
  const title = String(body.title || '').slice(0, 500) || null;
  try {
    await env.ADMIN_DB.prepare(
      `INSERT INTO video_whitelist (external_id, title, added_by) VALUES (?, ?, ?)`
    ).bind(external_id, title, auth.user.uid).run();
    return new Response(JSON.stringify({ external_id, title }), {
      status: 201, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('PRIMARY')) {
      return new Response('Already whitelisted', { status: 409 });
    }
    throw e;
  }
}

export async function deleteWhitelist(request, env, external_id) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;
  const result = await env.ADMIN_DB.prepare(
    `DELETE FROM video_whitelist WHERE external_id = ?`
  ).bind(external_id).run();
  if (result.meta.changes === 0) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 204 });
}

export async function listPublicWhitelist(request, env) {
  const rows = await env.ADMIN_DB.prepare(
    `SELECT external_id FROM video_whitelist`
  ).all();
  const ids = rows.results.map(r => r.external_id);
  return new Response(JSON.stringify(ids), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, max-age=30'
    }
  });
}
