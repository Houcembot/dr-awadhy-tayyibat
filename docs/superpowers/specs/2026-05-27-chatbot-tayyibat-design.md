# Chatbot Tayyibat — Design Spec
**Date :** 2026-05-27  
**Projet :** Dr Dhiaa Al Awadhy — Système Tayyibat  
**Site :** tayyibat.pages.dev  
**Phase :** C — MVP sur métadonnées existantes

---

## Contexte et objectif

Permettre à un visiteur ayant un symptôme ou une maladie de poser une question en arabe, français ou anglais et de recevoir immédiatement une réponse basée sur les enseignements du Dr Dhiaa Al Awady, accompagnée des liens vers les vidéos YouTube de référence.

Le chatbot repose sur les **1094 métadonnées vidéo existantes** (titres arabes, sujets, tags) sans transcripts. C'est une phase de validation : si l'expérience utilisateur est concluante, on passe à la Phase A (RAG complet avec transcripts Whisper).

---

## Public cible

Toute personne avec un problème de santé cherchant ce que le Dr Al Awady recommande — quelle que soit sa langue. Priorité à l'arabe (langue d'origine du Dr).

---

## Architecture

```
tayyibat.pages.dev (Cloudflare Pages — statique)
        │
        ├── /chat.html          → page dédiée chatbot
        ├── Widget flottant      → présent sur toutes les pages
        │
        │  POST /api/chat (JSON)
        ▼
Cloudflare Worker  (projet : tayyibat-chat)
        │
        ├── 1. Reçoit { question, lang? }
        ├── 2. Filtre les vidéos par mots-clés
        │      (title_original + primary_topic + tags)
        │      → top 25 vidéos pertinentes
        ├── 3. Construit le prompt Gemini
        ├── 4. Appel Google Gemini 2.0 Flash API
        ├── 5. Parse { answer, video_ids[] }
        ├── 6. Rate limit : 20 req/min/IP (Cloudflare KV)
        └── 7. Retourne { answer, videos[] }

Google Gemini 2.0 Flash (gratuit — 1M tokens/jour)
```

---

## Cloudflare Worker

### Endpoint

```
POST https://tayyibat-chat.<account>.workers.dev/api/chat
```

Hébergé sur un sous-domaine Worker séparé de Cloudflare Pages. La clé API Gemini est stockée comme secret Worker (`GEMINI_API_KEY`).

### Request / Response

```json
// Request
{
  "question": "ما علاج السكري؟",
  "lang": "ar"   // optionnel, auto-détecté si absent
}

// Response (succès)
{
  "answer": "يقول الدكتور ضياء العوضي أن السكري من النوع الثاني...",
  "videos": [
    {
      "id": "yt-XXXX",
      "title": "السكري والأنسولين",
      "url": "https://www.youtube.com/watch?v=XXXX",
      "duration": "12:34",
      "topic": "السكري والأنسولين والسكر في الدم"
    }
  ]
}

// Response (erreur)
{ "error": "rate_limit" | "model_error" | "no_results" }
```

### Logique de filtrage des vidéos

1. Tokeniser la question (mots arabes, français, anglais)
2. Matcher contre `title_original`, `primary_topic`, `tags` de chaque vidéo
3. Score = nombre de tokens matchés (pondéré : topic > title > tags)
4. Retenir les 25 meilleures correspondances

### Prompt Gemini

```
SYSTEM:
Tu es l'assistant du Dr Dhiaa Al Awady, médecin égyptien spécialisé en nutrition thérapeutique et fondateur du Système Tayyibat.

Philosophie du Dr Al Awady :
- 90% des maladies chroniques commencent dans un système digestif épuisé et inflammé
- Les aliments Tayyibat (viandes rouges, riz blanc, ghee, huile d'olive, miel) réduisent l'inflammation
- Les aliments Khabith (farine blanche, poulet industriel, lait, légumineuses) augmentent la charge digestive
- Le jeûne intermittent est un outil thérapeutique
- La réduction progressive des médicaments est possible quand le corps récupère

Règles de réponse :
- Réponds TOUJOURS dans la même langue que la question
- Sois clair, concis, bienveillant
- Cite les vidéos de référence par leur video_id
- Rappelle toujours que le contenu est informatif, pas un avis médical
- Format de sortie : JSON strict { "answer": "...", "video_ids": ["id1", "id2"] }

Vidéos disponibles (extraits pertinents à la question) :
[LISTE DES 25 VIDÉOS FILTRÉES]

USER:
[QUESTION DE L'UTILISATEUR]
```

### CORS

Le Worker doit répondre aux requêtes cross-origin depuis `https://tayyibat.pages.dev` :

```
Access-Control-Allow-Origin: https://tayyibat.pages.dev
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### Rate limiting

Compteur par IP dans Cloudflare KV : 20 requêtes/minute. Au-delà → réponse 429 avec message dans la langue détectée.

---

## Frontend

### Page `/chat.html`

Structure de la page :
- Header identique aux autres pages (nav + lang switcher FR/EN/AR)
- Zone de messages (scrollable)
- Message d'accueil initial du bot (en 3 langues selon localStorage)
- Champ de saisie + bouton envoyer
- Support RTL automatique quand lang = ar

```
┌─────────────────────────────────────────┐
│  نظام الطيبات  [Accueil] [Vidéos] [Chat]│
│                          [FR] [EN] [AR] │
├─────────────────────────────────────────┤
│                                         │
│  🤖 مرحباً! اسألني عن صحتك             │
│     Je suis là pour t'aider...          │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ ما علاج السكري؟               │   │
│  └─────────────────────────────────┘   │
│                                         │
│  🤖 يقول الدكتور ضياء العوضي أن...    │
│                                         │
│  ┌──────────────────┐ ┌─────────────┐  │
│  │ 📹 السكري        │ │ 📹 الأنسولين│  │
│  │ 12:34 · YouTube  │ │ 8:20 · YT   │  │
│  └──────────────────┘ └─────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│ [اكتب سؤالك...]              [← إرسال] │
└─────────────────────────────────────────┘
```

### Widget flottant

- Bouton circulaire fixe en bas à droite (ou bas à gauche en RTL)
- Icône : bulle de dialogue
- Au clic → overlay chat (même UI que la page, mais en modal)
- Présent sur `/` et `/videos`

### i18n du chatbot

Le message d'accueil et les textes d'interface suivent `localStorage.lang` :

| Clé | FR | EN | AR |
|-----|----|----|-----|
| `chat_placeholder` | Posez votre question... | Ask your question... | اكتب سؤالك... |
| `chat_send` | Envoyer | Send | إرسال |
| `chat_welcome` | Bonjour ! Je suis... | Hello! I am... | مرحباً! أنا... |
| `chat_source` | Voir la vidéo | Watch video | شاهد الفيديو |
| `chat_disclaimer` | Ceci est informatif... | This is informational... | هذا للمعلومات... |
| `chat_error` | Erreur, réessaye... | Error, try again... | خطأ، أعد المحاولة... |

---

## Fichiers à créer

```
tayyibat/
├── chat.html                          ← page dédiée chatbot
├── chat-worker/                       ← projet Cloudflare Worker
│   ├── src/index.js                   ← logique Worker
│   ├── wrangler.toml                  ← config déploiement
│   └── package.json
└── docs/superpowers/specs/
    └── 2026-05-27-chatbot-tayyibat-design.md
```

---

## Déploiement

```bash
# Worker
cd chat-worker
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy

# Page statique — intégrée dans le déploiement existant
npx wrangler pages deploy . --project-name tayyibat --commit-dirty=true
```

---

## Limites de la Phase C

- Le chatbot connaît les **titres et sujets** des vidéos, pas leur **contenu réel**
- Les réponses sont basées sur la philosophie générale du Dr + les vidéos les plus proches du sujet
- Une question très spécifique ("que dit le Dr sur l'acidité après 18h de jeûne?") sera moins précise qu'avec des transcripts
- **Critère de passage à la Phase A :** si >100 questions/semaine après lancement → investir dans les transcripts Whisper

---

## Évolution vers Phase A (RAG)

Quand les transcripts Whisper arrivent (Codex pipeline) :
1. Découper les transcripts en chunks de 500 tokens
2. Générer des embeddings via Cloudflare Workers AI ou Gemini Embeddings
3. Stocker dans Cloudflare Vectorize
4. Remplacer le filtrage par mots-clés par une recherche vectorielle
5. Le Worker reste identique côté API → zero changement frontend
