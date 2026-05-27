import { filterVideos } from './filter.js';
import { buildPrompt } from './prompt.js';
import { checkRateLimit } from './ratelimit.js';
import { corsHeaders, handlePreflight } from './cors.js';
import videosData from './videos.json';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
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

    // Call Gemini
    let geminiData;
    try {
      const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 1024,
            temperature: 0.3
          }
        })
      });
      if (!geminiRes.ok) throw new Error(`Gemini ${geminiRes.status}`);
      geminiData = await geminiRes.json();
    } catch (err) {
      console.error('Gemini error:', err);
      return Response.json(
        { error: 'model_error' },
        { status: 502, headers: corsHeaders(request) }
      );
    }

    // Parse Gemini response
    let parsed;
    try {
      const text = geminiData.candidates[0].content.parts[0].text;
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
