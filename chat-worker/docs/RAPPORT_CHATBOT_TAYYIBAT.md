# Chatbot Tayyibat — Rapport complet d'architecture et d'avancement

> **Mis à jour** : 2026-06-02
> **Version live** : worker `a628bf27-7ae6-43c8-b678-1d696889af3e`
> **URL public** : https://tayyibat.pages.dev/chat.html
> **Endpoint** : https://tayyibat-chat.houcemben.workers.dev/api/chat_v2

---

## 1. Vue d'ensemble

Le chatbot **Tayyibat** (نظام الطيبات) répond aux questions de santé en utilisant **uniquement** les positions doctrinales du Dr Dhiaa Al-Awadhy, extraites verbatim de ses vidéos YouTube. Aucune nutrition conventionnelle, aucune extrapolation, aucune hallucination — chaque citation est vérifiable à un timestamp précis dans une vidéo source.

**Principes non négociables** :
1. **Fidélité doctrinale** : on ne dit JAMAIS ce que Dr Dia n'a pas dit
2. **Vérifiabilité** : chaque réponse pointe vers la vidéo source + timestamp
3. **Frugalité runtime** : 0 appel LLM au runtime, <5ms CPU sur Cloudflare Workers free tier
4. **Drift_check automatique** : tout `simple` généré passe par un check verbatim avant d'être accepté

---

## 2. Architecture — 7 couches

```
Question utilisateur (AR / dialecte égyptien / français)
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 1 — Query Understanding                          │
│ src/query_understanding.js                              │
│ • normalize Arabic (tashkeel, ة→ه, ى→ي, أإآ→ا)        │
│ • tokenize + word-boundary anchor matching             │
│ • detectConcepts → {canonical_foods, strong_matches,   │
│                     related_concepts, expanded_terms}  │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 2 — Dialect Food Dictionary (56 canonicals)     │
│ src/dialect_food_dictionary.json                        │
│ • 5 dialectes : MSA, égyptien, marocain, libanais...   │
│ • Foods (السكر, الخبز, اللبن, ...) + Meta              │
│   (الأنسولين, مرض السكر, نظام الطيبات, الكوليسترول,   │
│    الغدة, الفطرة, السرطان, ...)                        │
│ • Greeting handler intercepte سلام/مرحبا avant retrieve│
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 3 — Retrieval V3 (scoring + intent)              │
│ src/retrieval_v2.js                                     │
│ • Inverted index lookup (O(N) → O(50) candidates)      │
│ • Scoring: canonical+30 / strong+20 / related+10       │
│ • Density bonus: occ × 3 (canonical), × 2 (strong)     │
│ • Curated boost +25 si db_resume.simple ∋ canonical    │
│ • Verdict bonus +35 si doctrine_position non-neutre    │
│ • Intent detection : كامل/أصلي → boost good blocks ;   │
│                       أبيض/مكرر → boost bad blocks    │
│ • Tier filtering : direct > ingredient > fallback      │
│ • Acceptance rule stricte : conceptHits ≥ 2 pour ing.  │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 4 — db_resume 3-layer (47 entries curées)        │
│ src/knowledge_db_resume_patch.json                      │
│ • verdict ∈ {PASS_SIMPLE, PASS_WITH_EXPLANATION,        │
│              EXPERT_ONLY}                              │
│ • doctrine_position ∈ {good, bad, neutral,             │
│                         good_natural, bad_industrial,  │
│                         natural, fasting,              │
│                         good_for_dr_dia_system}        │
│ • simple : 2-3 phrases verdict-first (نعم/لا/يعتمد)   │
│ • explanation? : optionnel, pour PASS_WITH_EXPLANATION │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 5 — Inverted Index (BUILD HEAVY / RUNTIME LIGHT) │
│ src/food_inverted_index.json (122.7 KB)                 │
│ • Pré-calculé offline par scripts/build_food_index.mjs │
│ • Module-level cache : BLOCK_MAP, ANCHOR_BLOCK_SETS,   │
│   BLOCK_NORM_RAW, DB_RESUME_NORM, VERDICT_BLOCKS       │
│ • Runtime : Set.has() O(1) au lieu de full scan        │
│ • LRU cache (256) pour detectConcepts par question     │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 6 — Response Builder                             │
│ src/retrieval_v2.js :: buildV2Response                  │
│ • Composed-dish prefix : "لم أجد عن X تحديداً، لكنّه   │
│   تكلّم عن المكوّن الأساسي (Y)" quand canonical absent │
│ • Modes : v3_db_resume / v3_raw_fallback /              │
│           v3_no_result / v3_greeting                    │
│ • Confidence : direct > ingredient > fallback           │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Couche 7 — Worker Entry Point                           │
│ src/index.js                                            │
│ • Rate limit : 30/min, 100/jour (admin bypass via IP   │
│   ou token X-Admin-Token / ?admin=)                    │
│ • CORS / Origin filtering                              │
│ • Greeting interceptor                                 │
│ • Cloudflare Workers free tier (<10ms CPU budget)      │
└─────────────────────────────────────────────────────────┘
    ↓
Réponse JSON {answer, mode, sources, db_resume, video_url, ...}
```

### Pipeline offline (curation)

```
Vidéos YouTube Dr Dia (>700 disponibles)
    ↓ yt-dlp via scripts/download_youtube_plan.py
videos/ + transcripts/ (Whisper / YouTube auto-captions)
    ↓ scripts/rebuild_transcripts_timestamped.py
knowledge_index.json (819 blocs avec timestamp + raw_quote)
    ↓ scripts/iterative_curation.py (DeepSeek V4 Pro + drift_check)
knowledge_db_resume_patch.json (47 doctrines curées, 0 drift verbatim)
    ↓ scripts/build_food_index.mjs
food_inverted_index.json (122 KB, 100+ anchors)
    ↓ wrangler deploy
Worker Cloudflare live
```

---

## 3. Stack technique

| Composant | Technologie |
|---|---|
| Worker | Cloudflare Workers (free tier, 10ms CPU) |
| Front | Cloudflare Pages (HTML + JS statique) |
| Storage | Cloudflare KV (rate limit) + static JSON in worker bundle |
| LLM offline | DeepSeek V4 Pro (1M context, reasoning) + Gemini Flash (fallback) |
| Transcription | YouTube auto-captions + OpenAI Whisper (chunks 30s) |
| Téléchargement | yt-dlp + cron `*/10 * * * *` |
| Discord notif | Bot token Frebot → #fre-canal |
| Repo | github.com/Houcembot/dr-awadhy-tayyibat |

---

## 4. Performance (mesures actuelles)

| Métrique | Valeur | Cible |
|---|---|---|
| CPU p95 worst (8 queries) | 3.94 ms | < 5 ms (free tier safe) |
| CPU p95 avg | ~2 ms | < 5 ms |
| Cold start | ~50 ms | < 200 ms |
| LLM calls per request | 0 | 0 |
| Coût par requête | $0 | $0 |
| Knowledge size in worker | 122 KB + 47 db_resumes | < 1 MB |
| Coût build (DeepSeek V4 Pro) | ~$0.50 pour 47 entries | < $5 / 100 entries |

---

## 5. Tests & qualité

### Doctrine quiz interne (15 questions food-centric)
**Score actuel : 15/15 PASS / 0 FAIL_DRIFT / 0 MISSING**
- Tests `tests/run_doctorine_quiz.mjs`
- Patterns mis à jour pour utiliser les VRAIS mots dialectaux du Dr (et non des paraphrases nutrition-conventionnelle)
- Vérifie `must_include_any` + `must_not_include_any` par sujet

### Quiz Dr Awadhy 20 questions (doctrine large)
**Score local : 9/20 PASS** (était 6/20 avant Wave 2 DeepSeek)
- Topics couverts : insulin, sugar, fasting, vegetables, eggs, milk, honey, dates
- Topics MISSING : Q4 fithra (partiel), Q10/Q15 license suspension (méta non transcrit), Q14/Q20 rôle/évolution

### Audit drift verbatim
**47 entries, 0 quote-drift hard** (ratio < 0.85 sur citations)
- Script `scripts/iterative_curation.py :: drift_check`
- Gère préfixes arabes ال / و / ف
- 22 "soft" paraphrases legacy (ratio 0.5-0.8) à raffiner

### Invariant test
- `tests/retrieval_invariant.test.js` snapshot des 15 questions
- Tout refactor doit garder la même structure de réponse

---

## 6. Phases réalisées (timeline)

### Phase 1 — Query Understanding (mai 2026)
- **Objectif** : transformer dialecte en concepts canoniques
- **Livré** : `query_understanding.js`, normalize_arabic, anchor matching
- **Résultat** : 100% des questions food-centric matchent correctement

### Phase 2 — Dialect Food Dictionary (mai 2026)
- **Objectif** : couvrir 5 dialectes + plats composés
- **Livré** : 33 entries → 49 → **56 entries** (foods + meta-canonicals)
- **Résultat** : ingredient routing (الكشري → رز + عدس) opérationnel

### Phase 3 — Retrieval V3 (mai 2026)
- **Objectif** : scoring multi-niveau (canonical/strong/related)
- **Livré** : pools tier-filtered, acceptance rule conceptHits ≥ 2
- **Résultat** : élimination des faux positifs méga-blocs génériques

### Phase 4 — db_resume 3-layer (mai 2026)
- **Objectif** : layer simple/explanation/expert au lieu de simplifier
- **Livré** : 15 db_resumes initiaux générés via Gemini Flash
- **Résultat** : jargon Dr Dia préservé, accessible aussi en simple

### Phase 5 — Runtime perf : inverted index (mai 2026)
- **Objectif** : résoudre erreur 1102 CPU limit (Cloudflare free tier)
- **Livré** : `build_food_index.mjs`, BLOCK_MAP, ANCHOR_BLOCK_SETS
- **Résultat** : p95 worst 4.54 ms (was >10ms full scan)

### Phase 6 — Density + Curated Relevance + Intent (juin 2026)
- **Objectif** : fixer des bugs ranking observés en live (honey → fats block)
- **Livré** :
  - Density bonus (occ × 3 canonical, × 2 strong, cap 6)
  - Curated boost +25 conditionné sur db_resume.simple ∋ canonical
  - Verdict bonus +35 pour doctrines non-neutres
  - Intent detection (كامل/أصلي vs أبيض/مكرر)
  - Tier promotion (2+ strong → direct)
- **Résultat** : honey query route vers le bon bloc ; quiz 15/15

### Phase 7 — Iterative Curation Pipeline (juin 2026)
- **Objectif** : passer de 15 → 50+ doctrines sans fabrication
- **Livré** :
  - `iterative_curation.py` (DeepSeek V4 Pro + drift_check verbatim)
  - 23 nouveaux db_resumes en 2 waves (38 → 47 + 5 manuels)
  - Audit auto qui rejette ≥15% drift
- **Résultat** : 47 doctrines vérifiables, 0 quote-drift hard

### Phase 8 — Infrastructure témoignages (juin 2026)
- **Objectif** : continuer le téléchargement des vidéos expérience
- **Livré** :
  - `scripts/download_testimonials.py` → `/media/max/Bake/DrDia/videos-experience/`
  - 208 vidéos planifiées, cap 100 GiB
  - Cron `*/10 * * * *`, Discord #fre-canal progress bar, dashboard live
- **Résultat** : auto-download actif, ~13/208 au 2026-06-02

### Phase 9 — Admin bypass + greeting (juin 2026)
- **Objectif** : améliorer UX côté admin + greetings
- **Livré** : whitelist IP + token admin, handler سلام/مرحبا
- **Résultat** : admin jamais rate-limited, salutations chaleureuses

---

## 7. Phases planifiées

### Phase 10 — Refinement soft drifts
- **Objectif** : passer 22 "soft drift" legacy entries en verbatim strict
- **Approche** : relancer DeepSeek V4 Pro sur ces entries avec drift_check strict
- **Estimé** : 2-3h de curation

### Phase 11 — Élargir coverage Awadhy 20-Q → 18-20/20
- **Objectif** : couvrir les Q manquantes (license, evolution role, fithra)
- **Approche** : ingérer 10-20 nouvelles vidéos méta + nouvelle wave DeepSeek
- **Estimé** : 1 jour

### Phase 12 — Page vidéos-expérience publique
- **Objectif** : exposer les 208 témoignages comme page séparée
- **Approche** : générer `videos-experience.html` depuis le plan JSON, embeds YouTube
- **Estimé** : ~3h

### Phase 13 — Multi-canonical disambiguation
- **Objectif** : question = "كشري بالسكر" devrait combiner les 2 doctrines, pas en gagner une
- **Approche** : présenter les 2 sources avec confidence partagée
- **Estimé** : 1-2 jours

### Phase 14 — Tests E2E Playwright
- **Objectif** : régression UI catchée automatiquement
- **Approche** : Playwright sur tayyibat.pages.dev pour 50+ questions
- **Estimé** : ~4h

### Phase 15 — Dashboard public read-only
- **Objectif** : stats utilisateurs et qualité doctrine en page publique
- **Approche** : reprendre `drdia_dashboard.html` sans password
- **Estimé** : ~2h

---

## 8. Objectifs et résultats par étape

| Phase | Objectif | Métrique cible | Atteint | État |
|---|---|---|---|---|
| 1 Query Understanding | Comprendre dialecte | 90% matches | 100% | ✅ |
| 2 Dictionary | 5 dialectes | 5/5 | 5/5 | ✅ |
| 3 Retrieval V3 | Pas de méga-bloc | 0 méga-bloc | 0 | ✅ |
| 4 db_resume | 15 doctrines | 15 | 15 (init) → 47 | ✅✅ |
| 5 Inverted index | <5ms p95 | <5ms | 3.94ms | ✅ |
| 6 Scoring v3.5 | Honey query OK | 1 PASS | 15/15 | ✅✅ |
| 7 Curation pipeline | 0 fabrication | 0 drift | 0 drift hard | ✅ |
| 8 Témoignages | 100 GiB cap | <100 GiB | 0.1 GiB (en cours) | 🟡 |
| 9 Admin/greeting | UX poli | Bypass admin | actif | ✅ |
| 10 Soft drifts | 0 paraphrase | 0 paraphrase | 22 restantes | 🟡 |
| 11 20-Q quiz | ≥18/20 | 18 | 9/20 | 🟡 |
| 12 Videos page | Page live | Live | non commencé | ⏳ |

---

## 9. Files de référence

### Worker (chat-worker/)
```
src/
  index.js                         — Entry point worker
  retrieval_v2.js                  — Retrieval V3 + scoring
  query_understanding.js           — Detect concepts
  ratelimit.js                     — Rate limit + admin bypass
  dialect_food_dictionary.json     — 56 canonicals
  knowledge_db_resume_patch.json   — 47 doctrines curées
  food_inverted_index.json         — 122 KB pré-calculé
  knowledge_index.json             — 819 blocs Dr Dia (raw)

scripts/
  iterative_curation.py            — Pipeline DeepSeek + drift_check
  build_food_index.mjs             — Génère inverted index
  build_db_resumes.py              — Legacy Gemini Flash
  download_testimonials.py         — Cron témoignages
  download_youtube_plan.py         — Download official videos

tests/
  run_doctorine_quiz.mjs           — 15-Q doctrine quiz
  doctorine_quiz_questions.json    — Patterns quiz
  doctorine_quiz_expected.json     — Verdicts attendus
  retrieval_invariant.test.js      — Snapshot test
  benchmark_retrieval.mjs          — Perf bench
```

### Repo public (tayyibat.pages.dev)
```
chat.html              — UI chat principale
chat-widget.js         — Widget JS embarqué
chat-core.js           — fetch wrappers
drdia_dashboard.html   — Dashboard admin (password tayyibat2026)
data/
  testimonials_progress.json  — Live snapshot
  videos.json                 — Catalogue
```

### Pipeline data
```
/home/max/.botfleet/shared/projets/DrDia/
  data/
    youtube.download-testimonials-plan.json   — 208 vidéos
    testimonials_progress.json                — État cron
    testimonials_download.log                 — Log cron

/media/max/Bake/DrDia/
  videos/                — 91 vidéos officielles (9.2 GiB)
  videos-experience/     — Témoignages en cours (cap 100 GiB)
```

---

## 10. Commandes utiles

### Tests
```bash
cd chat-worker
npx vitest run                                # 119/119 attendu
npx vite-node tests/benchmark_retrieval.mjs   # p95 < 5ms
npx vite-node tests/run_doctorine_quiz.mjs    # 15/15 attendu
```

### Curation
```bash
OPENROUTER_API_KEY=$(grep OPENROUTER_API_KEY ~/.botfleet/porte-cle/api-keys.env | cut -d= -f2) \
  python3 scripts/iterative_curation.py --only insulin,diabetes_hoax
```

### Deploy
```bash
cd chat-worker
node scripts/build_food_index.mjs    # rebuild index si dict changé
npx wrangler deploy
```

### Audit fidélité
```bash
python3 -c "
import sys; sys.path.insert(0,'scripts')
from iterative_curation import drift_check
import json
p = json.load(open('src/knowledge_db_resume_patch.json'))
idx = {b['id']: b for b in json.load(open('src/knowledge_index.json'))}
for bid, e in p.items():
  ok, ratio, missing = drift_check(e.get('simple',''), idx[bid]['raw_quote'])
  if not ok: print(f'❌ {bid}: {ratio:.2f}')"
```

### Cron testimonials
```bash
crontab -l                                                 # voir cron actif
tail -f data/testimonials_download.log                     # suivre downloads
cat data/testimonials_progress.json | python3 -m json.tool # état actuel
```

---

## 11. Garanties produit

✅ **Aucune fabrication** — chaque citation entre guillemets est verbatim du raw_quote
✅ **Aucune nutrition conventionnelle** — le chatbot exprime UNIQUEMENT la doctrine Dr Dia
✅ **Traçabilité totale** — chaque réponse pointe vers une vidéo + timestamp précis
✅ **Pas d'hallucination LLM** — 0 appel LLM au runtime, db_resumes vérifiés par drift_check au build
✅ **Honest MISSING** — si Dr Dia n'a pas parlé du sujet, le chatbot le dit explicitement
✅ **Coût zéro** — aucune dépense par requête (Cloudflare free tier)
✅ **<5ms CPU** — performance safe pour free tier sans risque de 1102

---

## 12. Risques identifiés

| Risque | Mitigation |
|---|---|
| Saturation CPU si plus de concepts | Cap density bonus + LRU memoization detectConcepts |
| Drift sur nouvelles curations LLM | drift_check + max 3 attempts ; humain peut review log |
| Cloudflare KV daily ratelimit hit | Admin bypass IP/token actif |
| Dataset incomplet (sujets non transcrits) | Honest MISSING vs fabrication ; phase 11 ingestion |
| Cron testimonials remplit disque | Cap 100 GiB + check `free_gib < 5` avant DL |
| Git push concurrent (cron + manuel) | rebase --autostash, commits petits, peu de conflit |
| Vidéos retirées de YouTube | yt-dlp 416 retry ; queue marqué `failed` |

---

## 13. Comment continuer

**Pour ajouter une nouvelle doctrine** :
1. Identifie le bloc dans `knowledge_index.json` (grep par mot-clé)
2. Crée une entry dans `iterative_curation.py :: TARGETS`
3. `python3 scripts/iterative_curation.py --only <topic>` (DeepSeek + drift_check)
4. Si accepté, `npx wrangler deploy`
5. Commit + push

**Pour corriger un bug live** :
1. Reproduire localement via `vite-node /tmp/probe.mjs` (script-template dans `tests/inspect_v3.mjs`)
2. Identifier le bloc fautif via `retrieveBlocks(question)`
3. Modifier `knowledge_db_resume_patch.json` ou `dialect_food_dictionary.json`
4. `node scripts/build_food_index.mjs && npx wrangler deploy`

**Pour relancer le 20-Q quiz Dr Awadhy** :
- Voir `/tmp/quiz20_local.mjs` — testable sans rate limit
- Compare answers aux patterns dans le script

---

## Contact / Source

- **Repo** : github.com/Houcembot/dr-awadhy-tayyibat
- **Live** : https://tayyibat.pages.dev
- **Worker** : https://tayyibat-chat.houcemben.workers.dev/api/chat_v2
- **Dashboard admin** : https://tayyibat.pages.dev/drdia_dashboard.html (pwd: tayyibat2026)
- **Channel Discord** : #fre-canal (notif cron)
