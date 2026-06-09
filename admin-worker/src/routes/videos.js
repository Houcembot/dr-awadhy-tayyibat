import { requireAuth } from '../auth.js';
import { parseUrl, fetchMeta } from '../platforms/index.js';

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
