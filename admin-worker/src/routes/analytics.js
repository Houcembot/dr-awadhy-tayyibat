import { requireAuth } from '../auth.js';

export async function getAnalytics(request, env) {
  const auth = await requireAuth(request, env.JWT_SECRET, ['admin']);
  if (auth.error) return auth.error;

  const summaryRow = await env.ADMIN_DB.prepare(
    `SELECT
       SUM(CASE WHEN is_chatbot_question = 0 THEN 1 ELSE 0 END) AS total_views_30d,
       COUNT(DISTINCT ip) AS unique_ips,
       AVG(CASE WHEN is_chatbot_question = 0 THEN duration_ms END) AS avg_duration_ms,
       SUM(CASE WHEN is_chatbot_question = 1 THEN 1 ELSE 0 END) AS chatbot_questions_30d
     FROM page_views
     WHERE ts >= datetime('now', '-30 days')`
  ).first();

  const topCountries = await env.ADMIN_DB.prepare(
    `SELECT country, COUNT(*) AS n FROM page_views
     WHERE ts >= datetime('now', '-30 days') AND country IS NOT NULL AND is_chatbot_question = 0
     GROUP BY country ORDER BY n DESC LIMIT 10`
  ).all();

  const topPages = await env.ADMIN_DB.prepare(
    `SELECT page_path, COUNT(*) AS n FROM page_views
     WHERE ts >= datetime('now', '-30 days') AND is_chatbot_question = 0
     GROUP BY page_path ORDER BY n DESC LIMIT 10`
  ).all();

  const recent = await env.ADMIN_DB.prepare(
    `SELECT id, ts, ip, country, page_path, lang, duration_ms, is_chatbot_question,
       substr(user_agent, 1, 80) AS ua
     FROM page_views ORDER BY id DESC LIMIT 200`
  ).all();

  return new Response(JSON.stringify({
    summary: {
      total_views_30d: summaryRow.total_views_30d || 0,
      unique_ips: summaryRow.unique_ips || 0,
      avg_duration_ms: Math.round(summaryRow.avg_duration_ms || 0),
      chatbot_questions_30d: summaryRow.chatbot_questions_30d || 0
    },
    top_countries: topCountries.results,
    top_pages: topPages.results,
    recent: recent.results
  }), { headers: { 'Content-Type': 'application/json' } });
}
