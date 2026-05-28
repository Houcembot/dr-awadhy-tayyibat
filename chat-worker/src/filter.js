// Arabic stop words that add noise without meaning
const STOP_WORDS = new Set([
  'ما','هو','هي','في','من','على','إلى','عن','مع','هل','لا','ال','أن','يا','لم','لن',
  'دكتور','الدكتور','ضياء','العوضي','يقول','قال','رأي','رأى','عند','حول',
  'إصلاح','محرك','سيارة','كهربائية'
]);

// Synonyms: map slang/dialect/foreign terms to canonical search tokens
const SYNONYMS = {
  'patate':     ['pomme', 'بطاط'],
  'potato':     ['pomme', 'بطاط'],
  'batata':     ['بطاط'],
  'batatis':    ['بطاط'],
  'poulet':     ['دجاج'],
  'chicken':    ['دجاج'],
  'riz':        ['أرز'],
  'rice':       ['أرز'],
  'miel':       ['عسل'],
  'honey':      ['عسل'],
  'beurre':     ['سمن', 'زبد'],
  'butter':     ['سمن', 'زبد'],
  'huile':      ['زيت'],
  'oil':        ['زيت'],
  'tomate':     ['طماط'],
  'tomato':     ['طماط'],
  'viande':     ['لحم'],
  'meat':       ['لحم'],
  'jeune':      ['صيام'],
  'fasting':    ['صيام'],
};

export function tokenize(text) {
  const raw = text
    .toLowerCase()
    .split(/[\s,،.。،؟?!،;:]+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

  const expanded = [];
  for (const t of raw) {
    expanded.push(t);
    if (SYNONYMS[t]) expanded.push(...SYNONYMS[t]);
  }
  return [...new Set(expanded)];
}

// Returns { videos, hasMatches }
export function filterVideos(question, videos, limit = 25) {
  const tokens = tokenize(question);
  if (tokens.length === 0) return { videos: [], hasMatches: false };

  const scored = videos.map(video => ({
    video,
    score: computeScore(tokens, video)
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video }) => video);

  if (matched.length === 0) {
    return { videos: [], hasMatches: false };
  }

  if (matched.length < limit) {
    const matchedIds = new Set(matched.map(v => v.id));
    const unmatched = videos
      .filter(v => !matchedIds.has(v.id))
      .slice(0, limit - matched.length);
    return { videos: [...matched, ...unmatched], hasMatches: true };
  }
  return { videos: matched, hasMatches: true };
}

// Normalize Arabic: strip definite article ال to improve cross-dialect matching
function normalize(text) {
  return text.replace(/\bال/g, '');
}

function computeScore(tokens, video) {
  const topicText    = (video.primary_topic || '').toLowerCase();
  const titleText    = (video.title_original || '').toLowerCase();
  const tagsText     = (video.tags || []).join(' ').toLowerCase();
  const summaryAr    = (video.summary_ar || '').toLowerCase();
  const summaryFr    = (video.summary_fr || '').toLowerCase();
  const conceptsText = (video.key_concepts || []).join(' ').toLowerCase();
  const excerptText  = (video.transcript_excerpt || '').toLowerCase();

  // Also normalize to handle البطاطا vs البطاطس vs بطاطا cross-dialect variants
  const normSummaryAr  = normalize(summaryAr);
  const normExcerpt    = normalize(excerptText);

  let score = 0;
  for (const token of tokens) {
    const normToken = normalize(token);
    if (topicText.includes(token))          score += 4;
    if (conceptsText.includes(token))       score += 3;
    if (summaryAr.includes(token))          score += 2;
    else if (normSummaryAr.includes(normToken)) score += 2; // dialect fallback
    if (summaryFr.includes(token))          score += 2;
    if (titleText.includes(token))          score += 2;
    if (tagsText.includes(token))           score += 1;
    if (excerptText.includes(token))        score += 1;
    else if (normExcerpt.includes(normToken))   score += 1; // dialect fallback
  }
  return score;
}
