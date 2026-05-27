import { filterVideos } from './filter.js';
import { buildPrompt } from './prompt.js';
import { checkRateLimit } from './ratelimit.js';
import { corsHeaders, handlePreflight } from './cors.js';
import videosData from './videos.json';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';
const videoMap = new Map(videosData.map(v => [v.id, v]));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return handlePreflight(request);
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      return new Response('Not found', { status: 404 });
    }

    // Rate limit — skip gracefully if KV not bound (local dev)
    if (env.RATE_LIMIT_KV) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const allowed = await checkRateLimit(env.RATE_LIMIT_KV, ip);
      if (!allowed) {
        return Response.json(
          { error: 'rate_limit' },
          { status: 429, headers: corsHeaders(request) }
        );
      }
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'invalid_json' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const question = String(body.question || '').trim();
    if (!question || question.length > 500) {
      return Response.json(
        { error: 'missing_question' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Build prompt
    const filtered = filterVideos(question, videosData, 25);
    const { system, user } = buildPrompt(question, filtered);

    // Call OpenRouter (OpenAI-compatible)
    let aiData;
    try {
      const aiRes = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://tayyibat.pages.dev',
          'X-Title': 'Tayyibat Chat'
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1024,
          temperature: 0.3
        })
      });
      if (!aiRes.ok) throw new Error(`OpenRouter ${aiRes.status}`);
      aiData = await aiRes.json();
    } catch (err) {
      console.error('OpenRouter error:', err);
      return Response.json(
        { error: 'model_error' },
        { status: 502, headers: corsHeaders(request) }
      );
    }

    // Parse response
    let parsed;
    try {
      const text = aiData.choices[0].message.content;
      parsed = JSON.parse(text);
    } catch {
      return Response.json(
        { error: 'model_error' },
        { status: 502, headers: corsHeaders(request) }
      );
    }

    // Resolve video_ids to full objects
    const videos = (parsed.video_ids || [])
      .map(id => videoMap.get(id))
      .filter(Boolean)
      .slice(0, 5)
      .map(v => ({
        id: v.id,
        title: v.title_original,
        url: v.source_url,
        duration: v.duration_label || '-',
        topic: v.primary_topic
      }));

    return Response.json(
      { answer: parsed.answer || '', videos },
      { headers: corsHeaders(request) }
    );
  }
};
