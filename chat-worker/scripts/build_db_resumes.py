#!/usr/bin/env python3
"""
build_db_resumes.py — Génère db_resume pour blocs ciblés via Gemini Flash.
Sortie : src/knowledge_db_resume_patch.json (séparé, lookup par block.id).

Usage:
    GEMINI_API_KEY=xxx python3 scripts/build_db_resumes.py --ids ID1,ID2,...
    GEMINI_API_KEY=xxx python3 scripts/build_db_resumes.py --ids "$(cat /tmp/db_resume_ids.txt)"
    GEMINI_API_KEY=xxx python3 scripts/build_db_resumes.py --ids ID1 --dry-run
    GEMINI_API_KEY=xxx python3 scripts/build_db_resumes.py --ids ID1 --force

Le patch JSON est une dict { block.id: "بحسب كلام الدكتور ضياء،..." }
Checkpoint atomique après chaque succès.
"""
import json, os, random, re, sys, time, argparse, urllib.request
from pathlib import Path

INDEX        = Path(__file__).parent.parent / 'src/knowledge_index.json'
PATCH        = Path(__file__).parent.parent / 'src/knowledge_db_resume_patch.json'
FAILED_LOG   = Path(__file__).parent / 'failed_db_resumes.json'
BASE        = 'https://generativelanguage.googleapis.com/v1beta/models'
MODEL       = 'gemini-2.5-flash-lite'

SYSTEM = """أنت تكتب إجابة مباشرة وواضحة لسؤال ضمني يُجيب عليه مقطع من كلام الدكتور ضياء العوضي (طبيب مصري متخصص في التغذية الوظيفية).

قواعد صارمة لا استثناء:
- جملة أو جملتان فقط
- أجب مباشرة على السؤال المطروح في الموضوع — لا تلخص فقط المقطع
- ابدأ دائماً بـ: بحسب كلام الدكتور ضياء،
- فقط ما قاله الدكتور بالضبط في المقطع — لا تزيد معلومة واحدة
- لا تكتب "استشر الطبيب" أو أي نصيحة طبية عامة
- لا تفسر ولا تضيف رأيك
- لا تتناقض مع المقطع المُعطى
- عربي واضح وبسيط

الإجابة: JSON فقط على الشكل: {"summary_ar": "الجملة هنا"}"""


def extract_json(text):
    """
    Try to extract {"summary_ar": "..."} from raw Gemini text.
    Handles: pure JSON, ```json blocks, text before/after JSON.
    Returns the parsed dict or raises ValueError with the raw text attached.
    """
    text = text.strip()

    # 1. Pure JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. ```json ... ``` code block
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # 3. First { ... } in the text (handles leading/trailing prose)
    start = text.find('{')
    end   = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    err = ValueError(f'Cannot parse JSON from Gemini response')
    err.raw_response = text
    raise err


def log_failure(block_id, raw_response, reason):
    failures = []
    if FAILED_LOG.exists():
        try:
            failures = json.loads(FAILED_LOG.read_text())
        except Exception:
            failures = []
    failures.append({'id': block_id, 'reason': reason, 'raw_response': raw_response})
    FAILED_LOG.write_text(json.dumps(failures, ensure_ascii=False, indent=2))


class RateLimitExhausted(Exception):
    """Raised when 429 persists after all retries — caller should stop the run."""


def call_gemini(key, block_id, topics, raw_quote, retries=3):
    prompt = f"الموضوع: {', '.join(topics)}\nالمقطع:\n{raw_quote[:700]}"
    body = json.dumps({
        'systemInstruction': {'parts': [{'text': SYSTEM}]},
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {
            'responseMimeType': 'application/json',
            'maxOutputTokens': 150,
            'temperature': 0.1,
        },
    }).encode()

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            f'{BASE}/{MODEL}:generateContent?key={key}',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                api_data = json.loads(r.read())
            break  # success
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt == retries:
                    raise RateLimitExhausted(f'429 after {retries} retries')
                wait = 30 * attempt  # 30s, 60s
                print(f'         429 — attente {wait}s (essai {attempt}/{retries})')
                time.sleep(wait)
            else:
                raise

    text = api_data['candidates'][0]['content']['parts'][0]['text'].strip()

    try:
        parsed = extract_json(text)
    except ValueError as e:
        raw = getattr(e, 'raw_response', text)
        log_failure(block_id, raw, 'json_parse_error')
        raise ValueError(f'JSON parse failed — logged to {FAILED_LOG.name}') from e

    summary = parsed.get('summary_ar', '').strip()
    if not summary:
        log_failure(block_id, text, 'empty_summary_ar')
        raise ValueError('summary_ar missing or empty in parsed JSON')

    return summary

def load_patch():
    """Load existing patch dict; return {} if file is empty or missing."""
    if not PATCH.exists():
        return {}
    try:
        text = PATCH.read_text().strip()
        if not text:
            return {}
        return json.loads(text)
    except json.JSONDecodeError:
        return {}

def save_patch(patch):
    """Atomic write to PATCH file (JSON object, indented for readability)."""
    tmp = PATCH.with_suffix('.tmp')
    tmp.write_text(json.dumps(patch, ensure_ascii=False, indent=2))
    tmp.replace(PATCH)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',  type=int,   default=None,  help='Traiter N blocs max')
    parser.add_argument('--ids',    type=str,   default=None,  help='IDs séparés par virgule')
    parser.add_argument('--force',  action='store_true',       help='Régénérer même si summary_ar existe')
    parser.add_argument('--dry-run',action='store_true',       help='Tester sans sauvegarder')
    parser.add_argument('--sleep',  type=float, default=2.5,   help='Secondes entre appels (défaut 2.5)')
    args = parser.parse_args()

    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GEMINI_KEY_1')
    if not key:
        print('Erreur: GEMINI_API_KEY non défini.')
        print('Usage: GEMINI_API_KEY=xxx python3 scripts/build_summaries.py')
        sys.exit(1)

    blocks = json.loads(INDEX.read_text())
    patch  = load_patch()

    if not args.ids:
        print('Erreur: --ids est obligatoire pour Étape 4 (génération ciblée sur les blocs critiques).')
        print('Usage: python3 scripts/build_db_resumes.py --ids "$(cat /tmp/db_resume_ids.txt)"')
        sys.exit(2)

    id_set = set(args.ids.split(','))
    targets = [b for b in blocks if b['id'] in id_set]

    todo = [b for b in targets if args.force or b['id'] not in patch]
    done_before = len(targets) - len(todo)

    print(f'Index  : {len(blocks)} blocs total')
    print(f'Cibles : {len(targets)} | À traiter : {len(todo)} | Déjà faits : {done_before}')
    if args.dry_run:
        print('DRY-RUN — aucune sauvegarde')
    print()

    ok = errors = 0
    stopped_early = False

    for i, block in enumerate(todo, 1):
        bid = block['id']
        try:
            summary = call_gemini(key, bid, block.get('topic', []), block['raw_quote'])
            if not args.dry_run:
                patch[bid] = summary
                save_patch(patch)  # checkpoint immédiat après chaque succès
            ok += 1
            print(f'[{i:>4}/{len(todo)}] ✓ {bid[:42]:<42}')
            print(f'         → {summary}')
        except RateLimitExhausted:
            errors += 1
            print(f'[{i:>4}/{len(todo)}] ✗ {bid[:42]:<42} — quota épuisé')
            print()
            print('⚠  429 persistant — arrêt propre du lot.')
            print('   Relancez après reset quota (minuit UTC ou clé différente).')
            stopped_early = True
            break
        except Exception as e:
            errors += 1
            print(f'[{i:>4}/{len(todo)}] ✗ {bid[:42]:<42} — {e}')

        if i < len(todo):
            time.sleep(args.sleep)

    n_total = len(patch)
    sep = '─' * 56
    print(f'\n{sep}')
    print(f'  Générés  : {ok}  |  Erreurs : {errors}{"  (arrêt quota)" if stopped_early else ""}')
    print(f'  Coverage : {n_total}/{len(blocks)} blocs avec summary_ar')
    print(f'  Fichier  : {INDEX}')
    print(sep)

    # Échantillon qualité : 10 summaries aléatoires parmi tous les blocs traités
    all_done = [b for b in blocks if b.get('summary_ar')]
    if all_done:
        sample = random.sample(all_done, min(10, len(all_done)))
        print(f'\n=== Échantillon qualité ({len(sample)} summaries aléatoires) ===')
        for b in sample:
            topics = ', '.join(b.get('topic', []))[:40]
            print(f'  [{b["id"][:30]}] [{topics}]')
            print(f'  → {b["summary_ar"]}')
            print()

if __name__ == '__main__':
    main()
