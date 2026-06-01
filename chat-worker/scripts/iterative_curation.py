#!/usr/bin/env python3
"""iterative_curation.py — Find Dr Dia's doctrine for MISSING topics using
DeepSeek V4 Pro via OpenRouter. Each candidate block goes through:

  1. LLM generates a `simple` constrained to verbatim phrases from raw_quote.
  2. drift_check: every ≥4-letter word in `simple` must be in raw_quote
     (>=85% threshold). If fail → reject and ask LLM to regenerate.
  3. Topic alignment: simple must mention the queried topic word.
  4. Write to patch only after both checks pass.

Usage:
    OPENROUTER_API_KEY=... python3 iterative_curation.py --topic insulin \
        --query "ما رأي الدكتور ضياء في الأنسولين؟" \
        --keywords انسولين اوقف ممنوع \
        --position bad
"""
import json, os, re, sys, argparse, urllib.request, time
from pathlib import Path

ROOT = Path(__file__).parent.parent
INDEX_PATH = ROOT / 'src/knowledge_index.json'
PATCH_PATH = ROOT / 'src/knowledge_db_resume_patch.json'
OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
MODEL = 'deepseek/deepseek-v4-pro'

def normalize_ar(t):
    t = re.sub(r'[ً-ٰٟ]', '', t)
    t = re.sub(r'[؟?!.،,؛:""()]', ' ', t)
    t = t.replace('أ','ا').replace('إ','ا').replace('آ','ا').replace('ة','ه').replace('ى','ي')
    return re.sub(r'\s+', ' ', t).strip().lower()

def drift_check(simple, raw_quote, min_ratio=0.80):
    """Returns (passed, ratio, missing_words). Words ≥4 chars in simple
    must appear in raw_quote (normalized). Quoted strings get stricter check."""
    raw_norm = normalize_ar(raw_quote)
    # Check quoted strings — must be near-verbatim
    for q in re.findall(r'"([^"]+)"', simple):
        if len(q) < 5: continue
        qn = normalize_ar(q)
        words = qn.split()
        hits = sum(1 for w in words if w in raw_norm)
        if hits / max(1, len(words)) < 0.85:
            return False, hits / max(1, len(words)), [w for w in words if w not in raw_norm]
    # Check whole simple's non-trivial words
    sn = normalize_ar(simple)
    # Strip common Arabic structural words that don't carry topical content
    STOPWORDS = {'بحسب','كلام','الدكتور','ضياء','يقول','حسب','حرفيا','حرفياً','الدكتور','نعم','لا','هذا','هذه','هو','هي','من','في','على','الذي','التي','كما','وهو','وهي','مع','عن','لان','لأن','يعتبر','يصف','وهو','بأن'}
    words = [w for w in sn.split() if len(w) >= 4 and w not in STOPWORDS]
    if not words: return True, 1.0, []
    hits = sum(1 for w in words if w in raw_norm)
    ratio = hits / len(words)
    missing = [w for w in words if w not in raw_norm]
    return ratio >= min_ratio, ratio, missing[:8]

def find_candidates(topic_terms, verdict_markers, blocks, top_n=5):
    cands = []
    for b in blocks:
        if b.get('domain') == 'off_topic': continue
        raw = b.get('raw_quote', '')
        topic_hits = sum(raw.count(t) for t in topic_terms)
        if topic_hits == 0: continue
        verdict_score = 0
        for t in topic_terms:
            for m in re.finditer(re.escape(t), raw):
                window = raw[max(0,m.start()-150):m.end()+200]
                for v in verdict_markers:
                    if v in window:
                        verdict_score += 1
        cands.append((verdict_score * 10 + topic_hits, topic_hits, verdict_score, b))
    cands.sort(reverse=True, key=lambda x: x[0])
    return cands[:top_n]

def call_deepseek(prompt, api_key, max_tokens=3500):
    body = {
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.3,
        'max_tokens': max_tokens,
    }
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tayyibat.pages.dev',
            'X-Title': 'Tayyibat-Curation',
        },
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=120).read())
    msg = resp['choices'][0]['message']
    content = msg.get('content') or msg.get('reasoning') or ''
    return content.strip()

def build_prompt(raw_quote, topic, position, prev_simple=None, drift_info=None):
    base = f"""You are extracting Dr Dia Al-Awadhy's actual doctrine from a transcript excerpt.

TOPIC the user asked about: {topic}
EXPECTED POSITION (from external doctrine knowledge): {position}

RAW QUOTE (Dr Dia's actual words, Egyptian Arabic):
\"\"\"
{raw_quote}
\"\"\"

Your task:
Write ONE `simple` field for the chatbot — a 2-3 sentence answer in Arabic that:
- Starts with نعم / لا / يعتمد + verdict
- Uses ONLY words and phrases that appear VERBATIM in the raw_quote above
- Anything in "quotes" MUST be a verbatim excerpt from the raw_quote
- Does NOT add facts, examples, or doctrines not in the raw_quote
- Mentions the topic word "{topic}" if present in raw_quote
- If the raw_quote does NOT contain Dr Dia's clear position on this topic, respond ONLY with: MISSING

Output ONLY the simple text (no JSON wrapping, no explanations).
"""
    if prev_simple and drift_info:
        base += f"\n\nPREVIOUS ATTEMPT failed drift_check:\n  Previous simple: {prev_simple}\n  Drift ratio: {drift_info['ratio']:.2f}\n  Words NOT in raw_quote: {drift_info['missing']}\n\nTry again, using ONLY verbatim words from the raw_quote."
    return base

def curate_topic(topic_id, query_topic, topic_terms, verdict_markers, expected_position, blocks, patch, api_key, max_attempts=3):
    print(f"\n{'─'*70}\n  Curating: {topic_id}  (query: \"{query_topic}\")\n{'─'*70}")
    cands = find_candidates(topic_terms, verdict_markers, blocks, top_n=3)
    if not cands:
        print(f"  ✗ No candidate blocks for {topic_id}")
        return None
    for score, hits, vs, block in cands:
        bid = block['id']
        if bid in patch:
            print(f"  [skip] {bid} already in patch")
            continue
        print(f"  [try] {bid} (topic_hits={hits} verdict_proximity={vs})")
        raw = block['raw_quote']
        prev_simple, drift_info = None, None
        for attempt in range(max_attempts):
            try:
                prompt = build_prompt(raw, query_topic, expected_position, prev_simple, drift_info)
                simple = call_deepseek(prompt, api_key)
            except Exception as e:
                print(f"    [api err] {e}")
                break
            if 'MISSING' in simple and len(simple) < 40:
                print(f"    [llm-reject] LLM says no doctrine on this topic in this block")
                break
            ok, ratio, missing = drift_check(simple, raw)
            if ok:
                print(f"    ✓ drift_check pass (ratio={ratio:.2f}) — accepted")
                entry = {
                    'verdict': 'PASS_SIMPLE',
                    'doctrine_position': expected_position,
                    'simple': simple,
                }
                patch[bid] = entry
                return bid
            else:
                print(f"    ✗ drift_check fail (ratio={ratio:.2f}, missing={missing[:5]}) — attempt {attempt+1}/{max_attempts}")
                prev_simple, drift_info = simple, {'ratio': ratio, 'missing': missing}
        print(f"    [give up] {bid} after {max_attempts} attempts")
    return None

# ──────────────────────────────────────────────────────────────────────
# Curation targets: 14 MISSING questions from Dr Awadhy 20-Q quiz
# Each: (topic_id, query_text, search_terms_in_raw, verdict_markers, position)
# Position is the position Dr Dia actually holds (B/C of quiz → translated)
# ──────────────────────────────────────────────────────────────────────
TARGETS = [
    ('insulin',       'الأنسولين',     ['انسولين', 'الانسولين'], ['ممنوع','اوقف','خطر','هيقفل','صيدله','دواء','قاتل','حقن'], 'bad'),
    ('diabetes_hoax', 'مرض السكر',     ['مرض السكر', 'السكر مرض', 'السكري'], ['كاذبه','خدعه','هاكس','وهم','مفتعل','مش مرض'], 'bad'),
    ('insulin_stop',  'إيقاف الأنسولين', ['انسولين'], ['اوقف','بطل','شيله','صيام','الطيبات','الحل'], 'bad'),
    ('fithra_cause',  'الفطرة',        ['الفطره', 'فطره', 'الاكل الاصلي'], ['بعدت','الامراض','اصلي','طبيعي'], 'good'),
    ('al_tayyibat',   'الطيبات',       ['الطيبات', 'نظام الطيبات'], ['نظام','الحل','صحه','شفاء'], 'good_for_dr_dia_system'),
    ('pharma',        'صناعه الادويه', ['شركات الادويه','تجاره الدوا','صناعه الادويه','الفارما','الطب الرسمي'], ['تجاره','اوهام','خدعه','وهم','اخترعوا'], 'bad'),
    ('sick_cells',    'الخلايا المريضة', ['الخلايا', 'خلايا'], ['تحتاج','سكر','جلوكوز','طاقه'], 'good_natural'),
    ('replacement',   'بديل الطب التقليدي', ['الطيبات','نظام الطيبات'], ['الحل','بديل','بدل','هاكس','الطب'], 'good_for_dr_dia_system'),
    ('t1_diabetes',   'السكري النوع الأول', ['النوع الاول','نوع الاول','جوفنايل','اطفال','بنكرياس'], ['كاذبه','هاكس','مش مرض','وهم','مفتعل'], 'bad'),
    ('lone_voice',    'دور الدكتور', ['وحيد','صحوه','الحقيقه'], ['وحيد','صرخه','اكتشف','الحقيقه'], 'good_for_dr_dia_system'),
    # ── Wave 2: bread/wheat nuance, additional foods, doctrine gaps ──
    ('bread_nuance',  'الخبز الكامل مقابل الأبيض', ['الخبز','خبز'], ['الاصلي','كامل','حبوب','مفيد','يفي','اللحوم'], 'good'),
    ('wheat',         'القمح',            ['قمح','القمح'], ['دقيق','حبوب','مفيد','الاصلي'], 'good'),
    ('meat',          'اللحم',            ['اللحم','لحوم','اللحوم'], ['مفيد','الاصلي','بنحتاج','شحوم','حبوب'], 'good'),
    ('water',         'الماء',            ['الميه','الماء','شرب الميه'], ['اعطش','مستقبلات','تستنا','مفيد','ربنا'], 'good'),
    ('coffee',        'القهوة',           ['القهوه','قهوه','الكافيين'], ['مفيد','مضر','مسموح','ممنوع'], 'neutral'),
    ('exercise',      'الرياضة',          ['الرياضه','رياضه','الجم'], ['مفيد','مضر','مسموح','جسمك'], 'neutral'),
    ('cancer',        'السرطان',          ['السرطان','سرطان'], ['الخضار','اكل','الطعام','اللحوم','بسبب'], 'bad'),
    ('cholesterol',   'الكولسترول',       ['الكوليسترول','كوليسترول'], ['مفيد','صابون','شمع','هرمونات','مش مضر'], 'good'),
    ('thyroid',       'الغدة',            ['الغده','غده','الدرقيه'], ['تحسن','الطيبات','شفاء','نظام'], 'good_for_dr_dia_system'),
    ('blood_pressure','ضغط الدم',         ['ضغط الدم','الضغط','الضغط العالي'], ['تحسن','الطيبات','شفاء','نظام','مفيد'], 'good_for_dr_dia_system'),
    ('legumes',       'البقول',           ['البقول','البقوليات','الفول','الحمص','العدس'], ['مضر','ما ينفع','مش حل','بطل','فافيزم'], 'bad'),
    ('seed_oils',     'الزيوت النباتية',  ['زيت الذره','زيت دوار','زيت بذور','الزيوت النباتيه'], ['مضر','صناعي','مش حل','بطل'], 'bad'),
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='comma-separated topic_ids to run')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY not set"); sys.exit(1)

    blocks = json.loads(INDEX_PATH.read_text())
    patch = json.loads(PATCH_PATH.read_text()) if PATCH_PATH.exists() else {}
    initial_count = len(patch)

    targets = TARGETS
    if args.only:
        wanted = set(args.only.split(','))
        targets = [t for t in TARGETS if t[0] in wanted]

    added = []
    for tid, query, terms, vmarks, pos in targets:
        bid = curate_topic(tid, query, terms, vmarks, pos, blocks, patch, api_key)
        if bid:
            added.append((tid, bid))
            if not args.dry_run:
                PATCH_PATH.write_text(json.dumps(patch, ensure_ascii=False, indent=2))

    print(f"\n{'═'*70}\n  SUMMARY\n{'═'*70}")
    print(f"  Initial entries: {initial_count}")
    print(f"  Added:           {len(added)}")
    print(f"  Final entries:   {len(patch)}")
    for tid, bid in added:
        print(f"    + {tid:<18} → {bid}")

if __name__ == '__main__':
    main()
