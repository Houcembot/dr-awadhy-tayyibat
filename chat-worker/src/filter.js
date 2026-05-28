// Arabic stop words that add noise without meaning
const STOP_WORDS = new Set([
  'ما','هو','هي','في','من','على','إلى','عن','مع','هل','لا','ال','أن','يا','لم','لن',
  'دكتور','الدكتور','ضياء','العوضي','يقول','قال','رأي','رأى','عند','حول',
  'إصلاح','محرك','سيارة','كهربائية'
]);

const GENERIC_DOMAIN_TOKENS = new Set(['الطيبات', 'طيبات', 'النظام', 'نظام']);

// Synonyms: map slang/dialect/foreign terms to canonical search tokens
const SYNONYMS = {
  // Latin/French/English → Arabic
  'patate':     ['بطاطا', 'بطاطس', 'بطاط'],
  'potato':     ['بطاطا', 'بطاطس', 'بطاط'],
  'batata':     ['بطاطا', 'بطاطس', 'بطاط'],
  'batatis':    ['بطاطا', 'بطاطس', 'بطاط'],
  'poulet':     ['دجاج', 'فراخ'],
  'chicken':    ['دجاج', 'فراخ'],
  'riz':        ['أرز'],
  'rice':       ['أرز'],
  'miel':       ['عسل'],
  'honey':      ['عسل'],
  'beurre':     ['سمن', 'زبد'],
  'butter':     ['سمن', 'زبد'],
  'huile':      ['زيت'],
  'oil':        ['زيت'],
  'tomate':     ['طماطم', 'طماط'],
  'tomato':     ['طماطم', 'طماط'],
  'salade':     ['سلطة', 'سلاطة', 'خضار', 'خضروات'],
  'salad':      ['سلطة', 'سلاطة', 'خضار', 'خضروات'],
  'viande':     ['لحم'],
  'meat':       ['لحم'],
  'jeûne':      ['صيام'],
  'jeune':      ['صيام'],
  'fasting':    ['صيام'],
  'sucre':      ['سكر'],
  'sugar':      ['سكر'],
  'insuline':   ['انسولين', 'أنسولين'],
  'insulin':    ['انسولين', 'أنسولين'],
  // Arabic cross-dialect synonyms (Egyptian ↔ MSA/Levantine)
  'بطاطا':     ['بطاطس', 'بطاط'],
  'بطاطس':     ['بطاطا', 'بطاط'],
  'بطاط':      ['بطاطا', 'بطاطس'],
  'سلطة':      ['سلاطة', 'خضار', 'خضروات'],
  'سلاطة':     ['سلطة', 'خضار', 'خضروات'],
  'خضار':      ['خضروات', 'سلطة', 'سلاطة'],
  'خضروات':    ['خضار', 'سلطة', 'سلاطة'],
  'فراخ':      ['دجاج'],
  'دجاج':      ['فراخ'],
  'فواكه':     ['فاكهة', 'فاكهه'],
  'فاكهة':     ['فواكه', 'فاكهه'],
  'طماطم':     ['طماط', 'طماطة'],
  'طماط':      ['طماطم', 'طماطة'],
  'انسولين':   ['أنسولين', 'إنسولين'],
  'أنسولين':   ['انسولين', 'إنسولين'],
  'مسموح':     ['مباح', 'مسموح به', 'المسموحات'],
  'ممنوع':     ['محظور', 'الممنوعات'],
};

export function tokenize(text) {
  const raw = text
    .toLowerCase()
    .split(/[\s,،.。،؟?!،;:]+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

  const expanded = [];
  for (const t of raw) {
    expanded.push(t);
    // Direct synonym lookup
    if (SYNONYMS[t]) expanded.push(...SYNONYMS[t]);
    // Also try without definite article ال (handles البطاطا → بطاطا)
    const stripped = t.replace(/^ال/, '');
    if (stripped !== t && SYNONYMS[stripped]) expanded.push(stripped, ...SYNONYMS[stripped]);
  }
  return [...new Set(expanded)];
}

// Returns { videos, hasMatches }
export function filterVideos(question, videos, limit = 25) {
  const tokens = tokenize(question);
  if (tokens.length === 0) return { videos: [], hasMatches: false };
  const scoringTokens = tokens.some(t => !GENERIC_DOMAIN_TOKENS.has(t))
    ? tokens.filter(t => !GENERIC_DOMAIN_TOKENS.has(t))
    : tokens;

  const scored = videos.map(video => ({
    video,
    score: computeScore(scoringTokens, video)
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video }) => video);

  if (matched.length === 0) {
    return { videos: [], hasMatches: false };
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
  const fullText     = (video.transcript_full || '').toLowerCase();

  // Also normalize to handle البطاطا vs البطاطس vs بطاطا cross-dialect variants
  const normSummaryAr  = normalize(summaryAr);
  const normExcerpt    = normalize(excerptText);
  const normFull       = normalize(fullText);

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
    if (fullText.includes(token))           score += 1;
    else if (normFull.includes(normToken))  score += 1; // full transcript fallback
  }
  return score;
}
