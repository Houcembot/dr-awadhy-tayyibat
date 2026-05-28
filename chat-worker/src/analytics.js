const ANALYTICS_TTL = 60 * 60 * 24 * 14;

function dayId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function blankDay(date) {
  return {
    date,
    visitors: 0,
    questions: 0,
    allowed: 0,
    blockedBurst: 0,
    blockedDaily: 0,
    noMatch: 0,
    modelErrors: 0,
    successes: 0,
    countries: {},
    languages: {},
    updatedAt: null,
  };
}

async function getJson(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function putJson(kv, key, value, ttl = ANALYTICS_TTL) {
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

function bump(map, key, amount = 1) {
  const normalized = key || 'unknown';
  map[normalized] = (map[normalized] || 0) + amount;
}

function classifyOutcome(outcome) {
  if (outcome === 'rate_limited_burst') return 'blockedBurst';
  if (outcome === 'rate_limited_daily') return 'blockedDaily';
  if (outcome === 'no_match') return 'noMatch';
  if (outcome === 'model_error') return 'modelErrors';
  return 'successes';
}

export function getClientInfo(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || 'unknown',
    country: request.cf?.country || request.headers.get('CF-IPCountry') || 'unknown',
  };
}

export async function recordChatUsage(kv, event) {
  if (!kv) return;

  const date = dayId();
  const now = new Date().toISOString();
  const ip = event.ip || 'unknown';
  const country = event.country || 'unknown';
  const lang = event.lang || 'unknown';
  const outcome = event.outcome || 'success';
  const dayKey = `chat:day:${date}`;
  const ipKey = `chat:ip:${date}:${ip}`;

  const ipStats = await getJson(kv, ipKey, null);
  const nextIpStats = ipStats || {
    ip,
    country,
    questions: 0,
    allowed: 0,
    blocked: 0,
    noMatch: 0,
    modelErrors: 0,
    successes: 0,
    languages: {},
    firstSeen: now,
    lastSeen: now,
    lastQuestionPreview: '',
  };

  nextIpStats.country = country;
  nextIpStats.questions += 1;
  nextIpStats.lastSeen = now;
  nextIpStats.lastQuestionPreview = String(event.question || '').slice(0, 120);
  bump(nextIpStats.languages, lang);
  if (outcome.startsWith('rate_limited')) nextIpStats.blocked += 1;
  else nextIpStats.allowed += 1;
  if (outcome === 'no_match') nextIpStats.noMatch += 1;
  else if (outcome === 'model_error') nextIpStats.modelErrors += 1;
  else if (outcome === 'success') nextIpStats.successes += 1;
  if (event.usage) nextIpStats.usage = event.usage;

  const dayStats = await getJson(kv, dayKey, blankDay(date));
  if (!ipStats) dayStats.visitors += 1;
  dayStats.questions += 1;
  if (outcome.startsWith('rate_limited')) dayStats.blocked += 1;
  else dayStats.allowed += 1;
  dayStats[classifyOutcome(outcome)] += 1;
  dayStats.updatedAt = now;
  bump(dayStats.countries, country);
  bump(dayStats.languages, lang);

  await Promise.all([
    putJson(kv, ipKey, nextIpStats),
    putJson(kv, dayKey, dayStats),
  ]);
}

function compactCountryMap(map) {
  return Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([country, count]) => ({ country, count }));
}

export async function getChatStats(kv) {
  if (!kv) return { error: 'missing_kv' };

  const today = dayId();
  const days = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(Date.now() - offset * 86400000);
    const id = dayId(date);
    days.push(await getJson(kv, `chat:day:${id}`, blankDay(id)));
  }

  const listed = await kv.list({ prefix: `chat:ip:${today}:`, limit: 1000 });
  const ips = await Promise.all(
    listed.keys.map(k => getJson(kv, k.name, null))
  );
  const topIps = ips
    .filter(Boolean)
    .sort((a, b) => b.questions - a.questions)
    .slice(0, 100);

  return {
    generatedAt: new Date().toISOString(),
    today: days[0],
    last7Days: days,
    topIps,
    countriesToday: compactCountryMap(days[0].countries),
  };
}
