import { filterVideos } from './filter.js';
import { buildPrompt } from './prompt.js';
import { extractQuotes } from './extract.js';
import { checkRateLimit, checkRateLimitV2 } from './ratelimit.js';
import { corsHeaders, handlePreflight } from './cors.js';
import videosData from './videos.json';
import { DASHBOARD_HTML } from './dashboard.js';
import { getChatStats, getClientInfo, recordChatUsage } from './analytics.js';
import { retrieveBlocks, buildV2Response } from './retrieval_v2.js';

// Google AI Studio — rotation sur 4 clés gratuites (1500 req/jour chacune = 6000/jour total)
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_KEYS  = ['GEMINI_KEY_2', 'GEMINI_KEY_3', 'GEMINI_KEY_4']; // KEY_1 réservée à l'expansion
const RETRYABLE_STATUS = new Set([429, 503, 529]);
const MAX_ATTEMPTS_PER_KEY = 2;
const MEDICAL_DISCLAIMER = {
  ar: 'هذا المحتوى للمعلومات فقط وليس بديلاً عن استشارة طبية.',
  fr: "Ce contenu est fourni à titre informatif et ne remplace pas une consultation médicale.",
  en: 'This content is for information only and does not replace medical consultation.',
};

const videoMap = new Map(videosData.map(v => [v.id, v]));
const DASHBOARD_TOKEN = 'tayyibat-drdia-2026';

// System prompt for query expansion — minimal, fast
const EXPAND_SYSTEM = `Tu reçois une question sur la nutrition/santé en n'importe quelle langue ou dialecte.
Extrais 3 à 7 mots-clés ARABES qui permettront de retrouver les passages pertinents dans des transcripts du Dr Dhiaa Al-Awady (dialecte égyptien).
Inclus : traductions arabes directes, synonymes dialectaux égyptiens, termes médicaux arabes liés.
Réponds UNIQUEMENT avec un tableau JSON de chaînes arabes. Exemple: ["سكر الدم","أنسولين","السكري"]`;

async function expandQueryToArabic(question, env) {
  const apiKey = getExpandKey(env);
  if (!apiKey) return [];
  try {
    const resp = await fetch(
      `${GEMINI_BASE}/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EXPAND_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 80, temperature: 0.1 },
        }),
      }
    );
    if (!resp.ok) {
      console.warn('expand_fail:', resp.status);
      return [];
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(t => typeof t === 'string' && t.length >= 2);
  } catch (e) {
    console.warn('expand_error:', e.message);
  }
  return [];
}

// Retourne les clés disponibles dans un ordre aléatoire, sans exposer les secrets dans les logs.
function getGeminiKeys(env) {
  const keys = GEMINI_KEYS
    .map(name => ({ name, value: env[name] }))
    .filter(k => k.value);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

// Clé dédiée à l'expansion (GEMINI_KEY_1) — séparée du pool de réponse
function getExpandKey(env) {
  return env['GEMINI_KEY_1'] || null;
}

async function callGemini(apiKey, model, system, user) {
  const resp = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 1024,
        temperature: 0.3,
      },
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw Object.assign(new Error(`Gemini ${resp.status}`), {
      status: resp.status,
      retryable: RETRYABLE_STATUS.has(resp.status),
      body: err,
    });
  }
  const data = await resp.json().catch(() => null);
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map(part => part.text || '').join('').trim() || '';
  if (!text) {
    throw Object.assign(new Error('Gemini empty response'), {
      status: 200,
      retryable: true,
      finishReason: candidate?.finishReason || null,
      blockReason: data?.promptFeedback?.blockReason || null,
      safetyRatings: candidate?.safetyRatings || data?.promptFeedback?.safetyRatings || null,
    });
  }
  return text;
}

function parseGeminiJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Le retry utilisera l'erreur initiale avec un aperçu court.
      }
    }
    throw Object.assign(new Error('Gemini invalid JSON'), {
      retryable: true,
      cause: err,
      preview: text.slice(0, 180),
    });
  }
}

function ensureMedicalDisclaimer(answer) {
  return String(answer || '').trim();
}

function responsePayload(answer, videos, lang, usage) {
  return { answer: ensureMedicalDisclaimer(answer), videos, usage };
}

async function getGeminiAnswer(env, system, user) {
  const keys = getGeminiKeys(env);
  if (keys.length === 0) {
    throw Object.assign(new Error('No Gemini API keys configured'), { retryable: false, attempts: [] });
  }

  const attempts = [];
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    for (const key of keys) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_KEY; attempt++) {
        try {
          const text = await callGemini(key.value, model, system, user);
          const parsed = parseGeminiJson(text);
          if (!parsed || typeof parsed.answer_ar !== 'string' || !parsed.answer_ar.trim()) {
            throw Object.assign(new Error('Gemini missing answer'), { retryable: true, preview: text.slice(0, 180) });
          }
          return parsed;
        } catch (err) {
          lastErr = err;
          attempts.push({
            model,
            key: key.name,
            attempt,
            status: err.status || null,
            message: err.message,
            retryable: err.retryable !== false,
            finishReason: err.finishReason || null,
            blockReason: err.blockReason || null,
            preview: err.preview || null,
          });
          if (err.retryable === false) {
            throw Object.assign(err, { attempts });
          }
        }
      }
    }
  }

  throw Object.assign(lastErr || new Error('Gemini exhausted'), { attempts });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handlePreflight(request);

    // Dashboard — accès restreint
    if (url.pathname === '/drdia_dashboard.html') {
      if (url.searchParams.get('token') !== DASHBOARD_TOKEN)
        return new Response('Accès refusé', { status: 403 });
      return new Response(DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (request.method === 'GET' && url.pathname === '/api/dashboard-stats') {
      if (url.searchParams.get('token') !== DASHBOARD_TOKEN)
        return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders(request) });
      return Response.json(await getChatStats(env.RATE_LIMIT_KV), { headers: corsHeaders(request) });
    }

    // Phase 2 — retrieval sans Gemini (endpoint séparé, pas de deploy requis)
    if (request.method === 'POST' && url.pathname === '/api/chat_v2') {
      let body2;
      try { body2 = await request.json(); }
      catch { return Response.json({ error: 'invalid_json' }, { status: 400, headers: corsHeaders(request) }); }
      const q2 = String(body2.question || '').trim();
      if (!q2 || q2.length > 500)
        return Response.json({ error: 'missing_question' }, { status: 400, headers: corsHeaders(request) });
      const client2 = getClientInfo(request);
      if (env.RATE_LIMIT_KV) {
        const { allowed } = await checkRateLimitV2(env.RATE_LIMIT_KV, client2.ip, request);
        if (!allowed)
          return Response.json({ answer: 'يرجى التمهل قليلاً.', sources: [], mode: 'v2_rate_limited' },
            { headers: corsHeaders(request) });
      }
      // Fire-and-forget tracking ping to tayyibat-admin /api/track-chat
      if (env.TRACKING_KEY && env.ADMIN_TRACK_URL) {
        ctx?.waitUntil?.(
          fetch(env.ADMIN_TRACK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Tracking-Key': env.TRACKING_KEY
            },
            body: JSON.stringify({
              ip: request.headers.get('CF-Connecting-IP'),
              country: request.headers.get('CF-IPCountry'),
              lang: ['fr', 'en', 'ar'].includes(body2.lang) ? body2.lang : null,
              user_agent: (request.headers.get('User-Agent') || '').slice(0, 200)
            })
          }).catch(() => {})
        );
      }
      // Greeting / small-talk handler — short messages with no food canonical
      // should get a friendly response instead of "no result".
      const qNorm = q2.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').toLowerCase();
      const GREETINGS = ['سلام','السلام','مرحبا','اهلا','صباح','مساء','هاي','يا دكتور','شكرا','شكراً','شكر'];
      if (q2.length <= 25 && GREETINGS.some(g => qNorm.includes(g.replace(/[أإآ]/g,'ا').replace(/ة/g,'ه')))) {
        return Response.json({
          answer: 'وعليكم السلام! أنا مساعد نظام الطيبات. اسألني عن صحتك أو أي طعام، مثلاً: "هل السكر صحي؟" أو "ما رأي الدكتور ضياء في الأنسولين؟"',
          sources: [], mode: 'v3_greeting', confidence_retrieval: 'greeting',
          confidence_source: null, understanding: null, db_resume: null,
          raw_quote: null, evidence: [], video_url: null,
        }, { headers: corsHeaders(request) });
      }

      const results  = retrieveBlocks(q2);
      const debugAllowed = (url.searchParams.get('debug') === '1') || (env.DEBUG === 'true');
      const payload  = buildV2Response(q2, results, videoMap, { debug: debugAllowed });
      return Response.json(payload, { headers: corsHeaders(request) });
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat')
      return new Response('Not found', { status: 404 });

    // Parse body
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'invalid_json' }, { status: 400, headers: corsHeaders(request) }); }

    const question = String(body.question || '').trim();
    if (!question || question.length > 500)
      return Response.json({ error: 'missing_question' }, { status: 400, headers: corsHeaders(request) });

    const lang = ['fr', 'en', 'ar'].includes(body.lang) ? body.lang : 'ar';
    const client = getClientInfo(request);
    let usage = null;
    const writeAnalytics = (outcome) => {
      ctx?.waitUntil?.(recordChatUsage(env.RATE_LIMIT_KV, {
        ...client,
        lang,
        question,
        outcome,
        usage,
      }));
    };

    // Rate limit (burst + daily)
    if (env.RATE_LIMIT_KV) {
      const { allowed, reason, usage: rateUsage } = await checkRateLimit(env.RATE_LIMIT_KV, client.ip, request);
      usage = rateUsage;
      if (!allowed) {
        const msg = {
          daily: { ar: 'لقد استعملت 50/50 سؤالاً خلال 24 ساعة. ارجع بعد 24 ساعة.', fr: 'Vous avez utilisé 50/50 questions sur 24h. Revenez dans 24 heures.', en: 'You have used 50/50 questions in 24h. Come back in 24 hours.' },
          burst: { ar: 'يرجى التمهل قليلاً بين الأسئلة.', fr: 'Veuillez patienter entre les questions.', en: 'Please wait a moment between questions.' },
        };
        const m = msg[reason] || msg.burst;
        writeAnalytics(reason === 'daily' ? 'rate_limited_daily' : 'rate_limited_burst');
        return Response.json({ answer: m[lang] || m.ar, videos: [], usage }, { headers: corsHeaders(request) });
      }
    }

    // Expand query to Arabic keywords — handles all languages/dialects automatically
    const arabicKeywords = await expandQueryToArabic(question, env);
    console.log('query_expansion:', JSON.stringify({ q: question.slice(0,60), kw: arabicKeywords }));
    // searchQuestion = original + arabic expansion (used for video filtering & quote extraction)
    const searchQuestion = arabicKeywords.length > 0
      ? question + ' ' + arabicKeywords.join(' ')
      : question;

    // Court-circuit si aucune vidéo ne correspond
    const { videos: filtered, hasMatches } = filterVideos(searchQuestion, videosData, 15);
    if (!hasMatches) {
      const noAnswerMsg = {
        ar: 'لم أجد إجابة محددة لهذا السؤال في محتوى الدكتور ضياء العوضي.',
        fr: "Je n'ai pas trouvé de réponse à cette question dans le contenu du Dr Dhiaa Al-Awady.",
        en: "I couldn't find an answer to this question in Dr Dhiaa Al-Awady's content.",
      };
      writeAnalytics('no_match');
      return Response.json(responsePayload(noAnswerMsg[lang] || noAnswerMsg.ar, [], lang, usage), { headers: corsHeaders(request) });
    }

    // Deterministic quote extraction — done BEFORE LLM call
    const quotes = extractQuotes(searchQuestion, filtered, 3);

    const { system, user } = buildPrompt(question, filtered, lang, quotes);

    // Appel Gemini avec rotation de clés + retry sur 429
    const fallbackMsg = {
      ar: 'حدث خطأ مؤقت. يرجى إعادة المحاولة.',
      fr: "Une erreur temporaire s'est produite. Veuillez réessayer.",
      en: 'A temporary error occurred. Please try again.',
    };

    let parsed;
    try {
      parsed = await getGeminiAnswer(env, system, user);
    } catch (err) {
      console.error('Gemini failed:', JSON.stringify({
        message: err.message,
        status: err.status || null,
        attempts: err.attempts || [],
        lang,
        matchedVideos: filtered.slice(0, 5).map(v => v.id),
      }));
      writeAnalytics('model_error');
      return Response.json({ answer: fallbackMsg[lang] || fallbackMsg.ar, videos: [], usage }, { headers: corsHeaders(request) });
    }

    const answerText = parsed.answer_ar || '';
    const NO_ANSWER_PHRASES = ['لم أجد', 'لا تكفي المقاطع', "n'ai pas trouvé", 'I did not find', 'لم يوجد'];
    const isNoAnswer = NO_ANSWER_PHRASES.some(p => answerText.includes(p));

    // Match source to the first video Gemini cited, fallback to extractQuotes[0]
    const geminiSourceIds = (parsed.sources || []).map(s => s.video_id).filter(Boolean);
    const geminiVideoId = geminiSourceIds[0] || '';
    const bestQuote = isNoAnswer
      ? null
      : (geminiVideoId && quotes.find(q => q.video_id === geminiVideoId)) || quotes[0] || null;
    const source = bestQuote ? {
      id: bestQuote.video_id,
      title: bestQuote.title,
      url: bestQuote.url + (bestQuote.seconds > 0 ? `&t=${bestQuote.seconds}` : ''),
      timestamp: bestQuote.timestamp,
      quote: bestQuote.quote,
      confidence: parsed.confidence || 'medium',
    } : null;

    // All extracted quotes as sources array
    const allSources = quotes.map(q => ({
      id: q.video_id,
      title: q.title,
      url: q.url + (q.seconds > 0 ? `&t=${q.seconds}` : ''),
      timestamp: q.timestamp,
      quote: q.quote,
    }));

    // Legacy videos field for backwards compatibility
    const legacyVideos = quotes.length > 0
      ? quotes.map(q => videoMap.get(q.video_id)).filter(Boolean)
          .map(v => ({ id: v.id, title: v.title_original, url: v.source_url, duration: v.duration_label || '-', topic: v.primary_topic }))
      : [];

    const payload = {
      ...responsePayload(answerText, legacyVideos, lang, usage),
      source,
      sources: allSources,
      confidence: parsed.confidence || 'medium',
    };

    writeAnalytics('success');
    return Response.json(payload, { headers: corsHeaders(request) });
  }
};
