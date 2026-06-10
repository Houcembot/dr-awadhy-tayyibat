# Analytics Visiteurs + Chatbot — Design

**Date** : 2026-06-10
**Projet** : DrDia / Tayyibat
**Statut** : Spec validée, prêt pour writing-plans
**Auteur** : brainstorming session avec houcemben@gmail.com

## 1. Contexte et objectif

La plate-forme Tayyibat (Pages statique + Worker chatbot + Worker admin) n'a aucune visibilité sur ses visiteurs. L'admin houcemben veut un dashboard dans `/admin.html` qui montre :

- Nombre de visiteurs uniques (30j)
- Visites totales (30j)
- IP brutes des visiteurs récents
- Nationalité (code pays ISO 2-lettres)
- Temps moyen passé par page
- Nombre de questions posées au chatbot

Pas d'outil tiers (Google Analytics, Plausible) — analytics 100% sous contrôle, intégré dans le Worker `tayyibat-admin` existant et la D1 `tayyibat-admin-db`.

## 2. Décisions actées

| # | Décision | Raison |
|---|----------|--------|
| 1 | Granularité = **agrégée + 200 visites récentes détaillées** | Équilibré entre utilité et privacy. Pas de stockage historique infini par visiteur. |
| 2 | Stack = **D1 + Worker custom** (étend `tayyibat-admin`) | Données sous contrôle, requêtables depuis l'admin, gratuit (free tier). Cohérent avec le reste du projet. |
| 3 | IP affichée **brute** dans l'admin | Admin = utilisateur seul, isolé derrière auth JWT. Plus utile pour détecter visites suspectes. |
| 4 | Rétention = **30 jours rolling** | Purge automatique via cron Worker quotidien. Bon compromis taille D1 / utilité historique. |

## 3. Architecture

### 3.1 Composants

1. **Worker `tayyibat-admin`** (étendu, pas de nouveau worker)
   - Nouvelles routes :
     - `POST /api/track` (no-auth, CORS allowlist `tayyibat.pages.dev`) — reçoit page-view du client
     - `POST /api/track-chat` (auth via secret partagé `X-Tracking-Key`) — reçoit ping du chat-worker
     - `GET /api/analytics` (auth admin only) — retourne stats agrégées + 200 dernières visites
   - Cron quotidien `0 3 * * *` UTC : purge `page_views` > 30 jours

2. **D1 table** `page_views` (nouvelle, migration 0004) — 1 ligne par page-view ou par question chatbot

3. **Worker `tayyibat-chat`** (modifié)
   - Sur chaque `/api/chat_v2` réussi, `ctx.waitUntil(fetch /api/track-chat)` fire-and-forget vers `tayyibat-admin`
   - Secret `TRACKING_KEY` ajouté via `wrangler secret put`

4. **Frontend public** — nouveau script `analytics.js` à la racine
   - Inclus en bas de `<body>` dans `index.html`, `videos.html`, `temoignages.html`, `chat.html`
   - Lit/écrit `sessionStorage('tayyibat:nav')` pour calculer la durée de la page précédente
   - Envoie via `navigator.sendBeacon` (fallback `fetch + keepalive`) — ne bloque jamais la navigation

5. **Frontend admin** (`admin.html`) — nouvel onglet "Analytics" (4ᵉ), admin only
   - Cards stats + tableau pays + tableau pages + tableau 200 visites récentes paginées
   - Auto-refresh manuel (bouton 🔄)

### 3.2 Flux de données

```
Visiteur → page Tayyibat
  └─→ analytics.js charge → sendBeacon POST /api/track
       └─→ tayyibat-admin Worker
            ├─ Vérifie rate-limit KV (30/min par IP)
            ├─ Vérifie bot regex sur User-Agent
            ├─ Valide path + lang + duration_ms
            ├─ Lit CF-Connecting-IP + CF-IPCountry headers
            └─→ INSERT page_views

Visiteur → /chat → pose question
  └─→ tayyibat-chat reçoit POST /api/chat_v2
       ├─ Génère réponse normalement
       └─ ctx.waitUntil(fetch /api/track-chat) ← fire-and-forget
            └─→ tayyibat-admin Worker (vérifie X-Tracking-Key)
                 └─→ INSERT page_views (is_chatbot_question=1)

Admin → /admin.html onglet Analytics
  └─→ GET /api/analytics (cookie auth)
       └─→ tayyibat-admin Worker (requireAuth ['admin'])
            ├─ SELECT agrégations (top countries, top pages, avg duration, totaux)
            ├─ SELECT 200 dernières visites
            └─→ JSON response → render cards + tables
```

## 4. Schéma D1

### Migration 0004

```sql
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT NOT NULL,
  country TEXT,                                       -- code ISO 2-lettres (CF-IPCountry)
  page_path TEXT NOT NULL,                            -- '/videos', '/temoignages', '/chat/question'
  lang TEXT,                                          -- 'fr' / 'en' / 'ar'
  referer TEXT,
  user_agent TEXT,                                    -- tronqué 200 chars max
  duration_ms INTEGER,                                -- durée page précédente, NULL pour 1re page
  is_chatbot_question INTEGER NOT NULL DEFAULT 0      -- 1 si appel /api/chat_v2
);
CREATE INDEX idx_pv_ts ON page_views(ts DESC);
CREATE INDEX idx_pv_ip ON page_views(ip);
CREATE INDEX idx_pv_country ON page_views(country);
CREATE INDEX idx_pv_chatbot ON page_views(is_chatbot_question) WHERE is_chatbot_question = 1;
```

### Requêtes admin (`GET /api/analytics`)

```sql
-- Stats globales (30 jours)
SELECT
  COUNT(*) AS total_views_30d,
  COUNT(DISTINCT ip) AS unique_ips,
  AVG(duration_ms) AS avg_duration_ms
FROM page_views
WHERE ts >= datetime('now', '-30 days') AND is_chatbot_question = 0;

-- Top pays (10)
SELECT country, COUNT(*) AS n
FROM page_views
WHERE ts >= datetime('now', '-30 days')
GROUP BY country ORDER BY n DESC LIMIT 10;

-- Top pages (10)
SELECT page_path, COUNT(*) AS n
FROM page_views
WHERE ts >= datetime('now', '-30 days') AND is_chatbot_question = 0
GROUP BY page_path ORDER BY n DESC LIMIT 10;

-- Questions chatbot 30j
SELECT COUNT(*) AS chatbot_questions_30d
FROM page_views
WHERE ts >= datetime('now', '-30 days') AND is_chatbot_question = 1;

-- 200 dernières visites (incluant chatbot)
SELECT id, ts, ip, country, page_path, lang, duration_ms, is_chatbot_question, substr(user_agent, 1, 80) AS ua
FROM page_views
ORDER BY id DESC LIMIT 200;
```

## 5. Sécurité

### 5.1 Authentification routes
| Route | Auth | Pourquoi |
|---|---|---|
| `POST /api/track` | **None** + CORS allowlist | Visiteurs anonymes, sinon impossible à tracker |
| `POST /api/track-chat` | **`X-Tracking-Key` secret** | Seul le chat-worker peut appeler |
| `GET /api/analytics` | **`requireAuth(['admin'])`** | Données personnelles, admin uniquement |

### 5.2 Anti-abus sur `/api/track`
- **Rate-limit KV par IP** : 30 inserts/min (réutilise `RATE_LIMIT_KV`). Compteur clé `track:ip:<ip>`, TTL 60s. Si > 30 → return 200 mais skip insert (silencieux pour ne pas révéler le throttling au scraper).
- **Bot filter** : regex sur user-agent. Liste blacklist : `Googlebot|Bingbot|AhrefsBot|SemrushBot|MJ12bot|DuckDuckBot|YandexBot|DotBot|PetalBot|Bytespider|GPTBot|ClaudeBot`. Si match → return 200 mais skip insert.
- **CORS strict** : `Access-Control-Allow-Origin` UNIQUEMENT pour `https://tayyibat.pages.dev` (et localhost en dev). Sinon refus en preflight.

### 5.3 Validation entrée stricte
- `path` : regex `^/[a-zA-Z0-9_/.\-]{0,80}$` (ou racine `/`). Sinon 400.
- `lang` : whitelist `{fr, en, ar}`. Sinon NULL.
- `referer` : taille max 500, sanitization HTTPS-only (refuse `javascript:`).
- `prev_path` : même validation que `path`, ou NULL.
- `prev_ts` : entier positif, doit être < `Date.now() + 5min`. Sinon NULL.
- `duration_ms` calculée serveur : `now - prev_ts`, plafonné à 30 min (1800000ms). > 30 min → NULL.
- `user_agent` : tronqué à 200 chars.

### 5.4 SQL
- Prepared statements D1 (`.prepare(...).bind(...)`) — pas d'interpolation
- Index sur `ts DESC` et `ip` pour requêtes rapides
- Pas d'index FULLTEXT (pas nécessaire à ce volume)

### 5.5 Privacy & RGPD
- Aucune donnée personnelle exposée hors auth admin
- IP brute affichée à l'admin authentifié uniquement
- Purge automatique 30 jours (cron) — pas de stockage permanent
- Pas de cookie de tracking (sessionStorage uniquement, expire à la fermeture onglet)
- **À ajouter Phase 2** : bandeau cookie/consent si publication EU; pour l'instant la cible MENA n'impose pas explicitement

### 5.6 Secrets Worker
- `TRACKING_KEY` : 32 octets aléatoires → 64 caractères hex — partagé entre `tayyibat-admin` et `tayyibat-chat`
- Généré via `openssl rand -hex 32` + `wrangler secret put TRACKING_KEY` sur les 2 workers

## 6. Frontend client (`analytics.js`)

Fichier à la racine du repo, ~40 lignes, zéro dépendance.

```js
(function() {
  const API = 'https://tayyibat-admin.houcemben.workers.dev/api/track';
  const KEY = 'tayyibat:nav';

  let prev = null;
  try { prev = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}

  const now = Date.now();
  const cur = { path: location.pathname || '/', ts: now };
  sessionStorage.setItem(KEY, JSON.stringify(cur));

  const body = JSON.stringify({
    path: cur.path,
    lang: document.documentElement.lang || localStorage.getItem('lang') || 'fr',
    referer: document.referrer || null,
    prev_path: prev?.path || null,
    prev_ts: prev?.ts || null
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
  } else {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  }
})();
```

Inclus en bas de `<body>` dans 4 pages : `index.html`, `videos.html`, `temoignages.html`, `chat.html`.

**Comportement** :
- Exécution non-bloquante (`sendBeacon`)
- Ne tracke pas si JS désactivé (acceptable)
- `sessionStorage` expire à la fermeture de l'onglet → respect implicite

## 7. Frontend admin (vue Analytics)

Nouvel onglet **"Analytics"** dans `admin.html` (4ᵉ position dans `<nav>`, admin only — masqué pour vérificateurs).

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Analytics (30 derniers jours)              [🔄 Rafraîchir]      │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐   │
│ │Visiteurs ││ Visites  ││Questions ││  Durée   ││ Pays #1  │   │
│ │ uniques  ││  totales ││ chatbot  ││ moy. /pg ││          │   │
│ │  1234    ││   8567   ││   412    ││ 2m 14s   ││ 🇹🇳 TN   │   │
│ └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘   │
├──────────────────────────┬──────────────────────────────────────┤
│ Top 10 pays              │ Top 10 pages                         │
│ ────────────────────     │ ─────────────────                    │
│ 🇹🇳 TN  ███████ 5421     │ /                ██████ 3210         │
│ 🇸🇦 SA  ████   1832      │ /temoignages     ████   1856         │
│ 🇪🇬 EG  ███    1024      │ /videos          ███     842         │
│ ...                      │ ...                                  │
├─────────────────────────────────────────────────────────────────┤
│ Dernières visites (200)                                         │
│ ─────────────────────                                           │
│ [Filtre pays ▼] [Filtre page ▼] [Recherche IP...]              │
│ ┌──────────────┬──────────────┬─────┬────────────┬───────┬───┐  │
│ │ Time         │ IP           │ Pays│ Page       │ Durée │Lan│  │
│ ├──────────────┼──────────────┼─────┼────────────┼───────┼───┤  │
│ │ 14:23:01     │ 41.225.x.x   │ 🇹🇳  │ /          │ 1m12  │ar │  │
│ │ 14:22:55     │ 197.7.x.x    │ 🇹🇳  │/temoignages│ 2m48  │fr │  │
│ │ ...          │              │     │            │       │   │  │
│ └──────────────┴──────────────┴─────┴────────────┴───────┴───┘  │
│ [Page 1/4]  [‹] [›]                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Composants (vanilla JS dans `admin.html`)

- Réutilise les tokens existants (`--gold`, `--cream`, `--dark`, `.card`, `.badge`)
- Cards stats : flex grid responsive (min 200px)
- Top tables : 2 colonnes 50/50 mobile-stack
- Tableau visites : `<table>` avec `<thead>` sticky, pagination 50/page côté client (toutes 200 chargées en une requête)
- Émojis drapeau pays : fonction utilitaire `countryFlag(code)` → renvoie l'émoji depuis le code ISO 2-lettres (regional indicator)

### États
- **Loading** : skeleton cards pendant fetch
- **Erreur 401** : reload login
- **Données vides** : "Aucune visite enregistrée dans les 30 derniers jours"

## 8. Modifications du chat-worker

Dans `chat-worker/src/index.js`, sur les routes `/api/chat`, `/api/chat_v2` :

```js
// après avoir construit la response réussie
if (env.TRACKING_KEY && env.ADMIN_TRACK_URL) {
  ctx.waitUntil(
    fetch(env.ADMIN_TRACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tracking-Key': env.TRACKING_KEY
      },
      body: JSON.stringify({
        ip: request.headers.get('CF-Connecting-IP'),
        country: request.headers.get('CF-IPCountry'),
        lang: body.lang || null,
        user_agent: request.headers.get('User-Agent')?.slice(0, 200) || null
      })
    }).catch(() => {})
  );
}
return response;
```

- `env.TRACKING_KEY` (secret) et `env.ADMIN_TRACK_URL` (var) ajoutés au `chat-worker/wrangler.toml`
- `ADMIN_TRACK_URL = "https://tayyibat-admin.houcemben.workers.dev/api/track-chat"`
- `waitUntil` = ne ralentit pas la réponse au visiteur
- `.catch(() => {})` = ne crashe pas si admin worker down

## 9. Cron purge (30 jours rolling)

Dans `admin-worker/wrangler.toml` :

```toml
[triggers]
crons = ["0 3 * * *"]   # 03:00 UTC quotidien
```

Dans `src/index.js`, handler `scheduled(event, env, ctx)` :

```js
async scheduled(event, env, ctx) {
  const r = await env.ADMIN_DB.prepare(
    "DELETE FROM page_views WHERE ts < datetime('now', '-30 days')"
  ).run();
  console.log(`purge_30d removed=${r.meta.changes}`);
}
```

## 10. Structure repo (additions)

```
DrDia/repo/
├── analytics.js                    ← nouveau (Pages)
├── admin.html                      ← modifié (+ vue Analytics)
├── index.html                      ← modifié (+ <script src="analytics.js">)
├── videos.html                     ← modifié (+ script)
├── temoignages.html                ← modifié (+ script)
├── chat.html                       ← modifié (+ script)
├── admin-worker/
│   ├── migrations/
│   │   └── 0004_page_views.sql     ← nouveau
│   ├── src/
│   │   ├── routes/
│   │   │   ├── track.js            ← nouveau (POST /api/track + POST /api/track-chat)
│   │   │   └── analytics.js        ← nouveau (GET /api/analytics admin only)
│   │   ├── bot_filter.js           ← nouveau (regex user-agent)
│   │   └── index.js                ← modifié (routes + scheduled handler)
│   ├── tests/
│   │   ├── bot_filter.test.js      ← nouveau
│   │   ├── routes_track.test.js    ← nouveau
│   │   └── routes_analytics.test.js ← nouveau
│   └── wrangler.toml               ← modifié ([triggers] crons)
└── chat-worker/
    ├── src/index.js                ← modifié (waitUntil track-chat)
    └── wrangler.toml               ← modifié (env.ADMIN_TRACK_URL + secret)
```

## 11. Tests

### Vitest unit
- `bot_filter.test.js` : matching regex bots (positifs et négatifs), normalisation user-agent
- Validation path / lang / duration / referer dans `routes_track.test.js`

### Vitest intégration (Miniflare D1 + KV)
- `routes_track.test.js` :
  - POST track valide → INSERT correct, headers CF lus
  - POST track avec UA bot → 200 sans INSERT
  - POST track au-delà du rate-limit → 200 sans INSERT
  - POST track sans Origin matching CORS → 403 preflight
  - POST track avec prev_ts → duration_ms correctement calculée et plafonnée
  - POST track-chat sans X-Tracking-Key → 401
  - POST track-chat avec bon header → INSERT `is_chatbot_question=1`
- `routes_analytics.test.js` :
  - GET sans auth → 401
  - GET vérificateur → 403
  - GET admin → toutes les stats agrégées correctes
  - GET admin → 200 dernières visites incluses
- Scheduled handler : insère 1 ligne ts=-40j + 1 ligne ts=-10j → cron supprime seulement la première

### E2E manuel (Playwright)
- Naviguer sur 3 pages (index, videos, temoignages)
- Poser 1 question chatbot
- Ouvrir `/admin.html` → onglet Analytics
- Vérifier : 4 visites apparaissent (3 pages + 1 chatbot), pays = TN, durées non-nulles sauf la première

## 12. Plan de déploiement

1. Migration 0004 D1 → `npx wrangler d1 execute tayyibat-admin-db --remote --file=migrations/0004_page_views.sql`
2. Générer `TRACKING_KEY` et `wrangler secret put` sur les 2 workers (admin + chat)
3. Implémenter routes + tests `tayyibat-admin` → `npx vitest run` (full suite verte)
4. Deploy `tayyibat-admin` → `npx wrangler deploy`
5. Modifier `chat-worker/src/index.js` + `wrangler.toml` ajout `env.ADMIN_TRACK_URL`
6. Deploy `tayyibat-chat` → `npx wrangler deploy`
7. Ajouter `<script src="/analytics.js">` dans 4 pages HTML
8. Ajouter vue Analytics dans `admin.html`
9. Deploy Pages (avec workaround symlink archive)
10. Smoke E2E manuel
11. Vérifier cron via `wrangler tail` après 03:00 UTC suivant ou trigger manuel via `npx wrangler triggers deploy`

## 13. Out-of-scope MVP (Phase 2)

- Sessions multi-IP (un même visiteur sur mobile + desktop comptés comme 2)
- Heatmap des clics
- Funnel conversion (entrée → /chat → question)
- Export CSV des visites
- Alertes (pic anormal de visites, attaque)
- Filtre temporel custom (7j / 14j / 90j / All)
- Détection bot par fingerprint comportemental
- Bandeau cookie/consent RGPD (si publication EU)
- Géolocalisation plus précise (région/ville, pas seulement pays)
- Tracking conversion (impressions → clics CTA sur vidéos)
