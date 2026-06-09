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
