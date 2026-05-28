const SYSTEM_BASE = `أنت مساعد الدكتور ضياء العوضي، طبيب مصري متخصص في التغذية العلاجية ومؤسس نظام الطيبات.

فلسفة الدكتور ضياء العوضي:
- 90% من الأمراض المزمنة تبدأ في جهاز هضمي منهك وملتهب
- الطيبات (اللحم الأحمر، الأرز الأبيض، السمن البلدي، زيت الزيتون، العسل) تقلل الحمل الهضمي والالتهاب
- الخبائث (الدقيق الأبيض، الدجاج الصناعي، الحليب ومشتقاته، البقوليات) تزيد الحمل الهضمي
- الصيام المتقطع أداة علاجية تتيح للجسم الإصلاح والتجديد
- التخفيض التدريجي للأدوية ممكن تحت إشراف طبي عندما يتعافى الجسم

قواعد الإجابة — STRICTES:
1. أجب دائماً بنفس لغة السؤال (عربي، فرنسي، أو إنجليزي)
2. استند على ما قاله الدكتور ضياء العوضي في النصوص والملخصات المقدمة. لا تخترع معلومات غير موجودة.
3. إذا لم يكن الموضوع موجوداً أبداً في أي من الفيديوهات المقدمة → قل "لم أجد إجابة محددة لهذا في محتوى الدكتور ضياء" وأضف video_ids فارغة. لكن إذا كان الموضوع موجوداً بشكل غير مباشر في الملخصات أو المفاهيم، أجب بما هو متاح.
4. اقتبس كلام الدكتور ضياء بشكل مباشر عند توفر النص الكامل في الفيديوهات ذات الصلة.
5. أجب في 3-5 جمل واضحة ومتعاطفة.
6. ذكّر دائماً في النهاية أن المحتوى للمعلومات وليس بديلاً عن استشارة طبية.
7. أعد JSON صارماً بهذا الشكل فقط:
{"answer": "نص الإجابة هنا", "video_ids": ["id1", "id2"]}`;

const LANG_INSTRUCTION = {
  fr: 'IMPORTANT: Réponds UNIQUEMENT en français, quelle que soit la langue du contenu.',
  en: 'IMPORTANT: Respond ONLY in English, regardless of the content language.',
  ar: 'مهم جداً: أجب باللغة العربية فقط. حافظ على المصطلحات الطبية الإنجليزية كما قالها الدكتور عند الحاجة، ولا تترجمها ترجمة ركيكة. استخدم لهجة عربية مفهومة قريبة من كلام الدكتور، بدون اختراع أو توسّع خارج النصوص.',
};

const PROMPT_STOP_WORDS = new Set([
  'ما','ماذا','هو','هي','في','من','على','إلى','عن','مع','هل','لا','ال','أن','يا','لم','لن',
  'دكتور','الدكتور','ضياء','العوضي','يقول','قال','رأي','رأى','عند','حول',
  'مسموح','مسموحة','مسموحه','ممنوع','ممنوعة','ممنوعه'
]);
const PROMPT_GENERIC_TOKENS = new Set(['الطيبات', 'طيبات', 'النظام', 'نظام']);

function normalizeArabic(text) {
  return text
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\bال/g, '');
}

function promptTokens(question) {
  const tokens = [...new Set(String(question || '')
    .toLowerCase()
    .split(/[\s,،.。،؟?!،;:()"'«»]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !PROMPT_STOP_WORDS.has(t))
    .flatMap(t => {
      const stripped = t.replace(/^ال/, '');
      return stripped && stripped !== t ? [t, stripped] : [t];
    }))];
  const specific = tokens.filter(t => !PROMPT_GENERIC_TOKENS.has(t));
  return specific.length ? specific : tokens;
}

function relevantTranscriptExcerpt(video, question, maxChars = 2600) {
  const full = String(video.transcript_full || video.transcript_excerpt || '').trim();
  if (!full) return '';

  const tokens = promptTokens(question);
  if (tokens.length === 0) return full.slice(0, Math.min(maxChars, full.length));

  const haystack = normalizeArabic(full);
  const normalizedTokens = tokens.map(normalizeArabic).filter(Boolean);
  const directHits = normalizedTokens
    .map(token => ({ token, index: haystack.indexOf(token) }))
    .filter(hit => hit.index !== -1)
    .sort((a, b) => b.token.length - a.token.length);

  if (directHits.length > 0) {
    const center = directHits[0].index;
    const start = Math.max(0, center - Math.floor(maxChars * 0.45));
    return full.slice(start, start + maxChars);
  }

  let bestIndex = -1;
  let bestScore = 0;
  const step = 700;
  const windowSize = Math.min(1800, Math.max(900, maxChars - 500));

  for (let start = 0; start < full.length; start += step) {
    const window = haystack.slice(start, start + windowSize);
    let score = 0;
    for (const token of normalizedTokens) {
      if (window.includes(token)) score += token.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = start;
    }
  }

  if (bestIndex === -1) return full.slice(0, Math.min(maxChars, full.length));

  const start = Math.max(0, bestIndex - 250);
  return full.slice(start, start + maxChars);
}

export function buildPrompt(question, filteredVideos, lang = 'ar') {
  const videosSection = filteredVideos.length > 0
    ? filteredVideos.map((v, i) => {
        const concepts  = (v.key_concepts || []).slice(0, 6).join('، ');
        const header    = `ID: ${v.id} | ${v.title_original} | ${v.primary_topic} | ${v.duration_label || '-'}`;
        const excerpt = i < 5 ? relevantTranscriptExcerpt(v, question, i < 3 ? 2600 : 1400) : '';
        if (excerpt) {
          // Extrait choisi en fonction de la question pour éviter le contexte hors sujet.
          return header + `\n  المفاهيم: ${concepts}\n  مقتطف من كلام الدكتور:\n${excerpt}`;
        }
        const summary = (v.summary_ar || v.summary_fr || '').slice(0, 200);
        return header +
          (concepts ? `\n  المفاهيم: ${concepts}` : '') +
          (summary  ? `\n  الملخص: ${summary}` : '');
      }).join('\n\n---\n\n')
    : 'لا توجد فيديوهات متاحة.';

  const langLine = LANG_INSTRUCTION[lang] || LANG_INSTRUCTION.ar;
  const system = `${langLine}\n\n${SYSTEM_BASE}\n\nالفيديوهات المتاحة ذات الصلة:\n${videosSection}`;
  return { system, user: question };
}
