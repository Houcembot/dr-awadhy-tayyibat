export async function listPublicVideos(request, env) {
  const rows = await env.ADMIN_DB.prepare(
    `SELECT id, platform, external_id, url, embed_url, title, thumbnail_url, duration_seconds, added_at
     FROM videos WHERE status = 'valide' ORDER BY added_at DESC`
  ).all();
  return new Response(JSON.stringify({ items: rows.results }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, max-age=30'
    }
  });
}
