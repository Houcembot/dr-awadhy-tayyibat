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

export function buildPrompt(question, filteredVideos, lang = 'ar') {
  const videosSection = filteredVideos.length > 0
    ? filteredVideos.map((v, i) => {
        const concepts  = (v.key_concepts || []).slice(0, 6).join('، ');
        const header    = `ID: ${v.id} | ${v.title_original} | ${v.primary_topic} | ${v.duration_label || '-'}`;
        if (i < 3 && v.transcript_excerpt) {
          // Top 3 : extrait transcript pour que l'IA puisse citer Dr Dia directement
          return header + `\n  المفاهيم: ${concepts}\n  النص:\n${v.transcript_excerpt.slice(0, 1500)}`;
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
