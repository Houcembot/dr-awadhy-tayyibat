# Admin Vidéos Témoignages — Design

**Date** : 2026-06-09
**Projet** : DrDia / Tayyibat
**Statut** : Spec validée, prêt pour writing-plans
**Auteur** : brainstorming session avec houcemben@gmail.com

## 1. Contexte et objectif

La page publique `tayyibat.pages.dev/temoignages` affiche actuellement 185 vidéos
YouTube de témoignages patients via un tableau JS inline (`const VIDEOS = [...]`
dans `temoignages.html`). Cette structure est statique : impossible d'ajouter,
supprimer ou modérer une vidéo sans éditer le HTML et redéployer.

Ce design introduit un système d'administration complet :
- Ajout de vidéos depuis YouTube, Facebook, Instagram, TikTok
- Workflow de modération à 2 statuts (`validé` / `pas validé`)
- Gestion multi-utilisateurs avec deux rôles (`admin`, `verificateur`)
- Page publique mise à jour automatiquement (affiche uniquement les `validé`)
- Audit trail complet de toutes les actions

## 2. Décisions actées

| # | Décision | Raison |
|---|----------|--------|
| 1 | Page publique affiche **seulement** les vidéos `validé` | Workflow de modération classique, protège la qualité avant exposition au public |
| 2 | Backend **Cloudflare D1** (SQLite) | Relations users/videos/log claires, requêtes filtrées, audit trail natif, gratuit |
| 3 | Migration des 185 vidéos existantes → statut **`pas_valide`** | Revalidation forcée, page publique vide jusqu'à ce que l'équipe ait revalidé |
| 4 | 2 statuts + **note libre optionnelle** + historique complet | Simple à utiliser, traçabilité préservée via `validation_log` |
| 5 | **Pages (HTML/JS) + Worker API séparé** (`tayyibat-admin`) | Séparation frontend/backend, isolation sécurité vs `tayyibat-chat`, même stack |

## 3. Architecture

### 3.1 Composants

1. **Page admin statique** — `tayyibat.pages.dev/admin.html`
   - SPA vanilla JS, zéro framework (cohérent avec le reste du site)
   - 3 vues client-side : Login, Vidéos, Utilisateurs
   - Tokens visuels partagés (`--gold`, `--cream`, `--dark`)
   - Polices Cairo + Source Sans 3 (mêmes que le site)
   - Langue par défaut FR

2. **Worker API** — `tayyibat-admin` (nouveau, indépendant du `tayyibat-chat`)
   - Routes auth : `POST /api/login`, `POST /api/logout`
   - Routes vidéos privées (auth required) :
     - `GET /api/videos` (liste paginée + filtres)
     - `POST /api/videos` (ajout)
     - `PATCH /api/videos/:id` (statut + note)
     - `DELETE /api/videos/:id` (admin only)
   - Routes utilisateurs (admin only) :
     - `GET /api/users`
     - `POST /api/users` (créer vérificateur)
     - `PATCH /api/users/:id` (désactiver / changer rôle)
     - `DELETE /api/users/:id`
   - Route publique no-auth : `GET /api/public/videos` (uniquement `status='valide'`, cache CDN 60s)
   - CORS : `Access-Control-Allow-Origin: https://tayyibat.pages.dev`

3. **Cloudflare D1** — binding `ADMIN_DB`
   - Database : `tayyibat-admin-db`
   - 3 tables : `users`, `videos`, `validation_log`

4. **Cloudflare KV** — binding `RATE_LIMIT_KV`
   - Réutilisation du namespace existant du `tayyibat-chat` (id `49981be2901d404b8f052e164b00b4d0`)
   - Compteurs anti brute-force login (clés `login:email:*` et `login:ip:*`, TTL automatique)

### 3.2 Frontend public (modification)

`temoignages.html` :
- Suppression de `const VIDEOS = [...]` inline
- Ajout d'un `fetch('https://tayyibat-admin.houcemben.workers.dev/api/public/videos')` au load
- Loading state pendant fetch, fallback vide si erreur réseau
- Reste du rendu (cards, recherche, filtres) inchangé

## 4. Schéma D1

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','verificateur')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_login_at TEXT
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK(platform IN ('youtube','facebook','instagram','tiktok')),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  embed_url TEXT,
  title TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'pas_valide' CHECK(status IN ('valide','pas_valide')),
  note TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at TEXT,
  UNIQUE(platform, external_id)
);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_platform ON videos(platform);

CREATE TABLE validation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('added','validated','unvalidated','deleted','noted')),
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_log_video ON validation_log(video_id, created_at);
```

### Seed initial
- 1 admin : `houcemben@gmail.com`, `display_name='Houcem'`, `role='admin'`
  - Password hashé depuis `INITIAL_ADMIN_PASSWORD` (secret Worker)
- 185 vidéos YouTube extraites de `temoignages.html` →
  - `platform='youtube'`, `status='pas_valide'`, `added_by=1`
  - Log `validation_log` action `'added'`

## 5. Sécurité

### 5.1 Hashing password
**PBKDF2-SHA256, 600 000 itérations**, salt 16 bytes random par user.
Web Crypto API natif Workers (pas de WASM, pas de dépendance externe).

### 5.2 Session
JWT signé **HS256**, payload `{ uid, role, iat, exp }`, durée **8 h fixe sans
renouvellement automatique** (re-login requis après expiration). Si une UX
"sliding" est souhaitée Phase 2, ajouter un endpoint `POST /api/refresh` qui
re-signe un JWT si le précédent est valide et expire dans <1 h.
Cookie `Auth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`.
Pas de stockage côté client (XSS-proof).

### 5.3 Anti brute-force (KV `RATE_LIMIT_KV`)
- Par email : 5 échecs / 15 min → blocage 30 min
- Par IP (header `CF-Connecting-IP`) : 20 échecs / 15 min → blocage 30 min

### 5.4 CSRF
- `SameSite=Strict` sur le cookie d'auth
- Tous les writes exigent l'en-tête `X-Requested-With: fetch` (vérifié serveur)

### 5.5 Autorisation
- Middleware `requireAuth(roles[])` au début de chaque route protégée
- Admin only : `DELETE /api/videos/*`, tous `/api/users/*` (sauf GET self)
- Vérificateur : peut `POST` et `PATCH` vidéos, **ne peut pas** `DELETE`
- JWT re-vérifié à chaque request (stateless)

### 5.6 Secrets Worker
- `JWT_SECRET` : 32 bytes random, via `wrangler secret put`
- `INITIAL_ADMIN_PASSWORD` : utilisé une fois au seed, peut être supprimé après

### 5.7 Validation entrée
- URL vidéo : regex stricte par plateforme + whitelist `https://` exclusivement
- Champs texte : tailles max (title 500, note 2000, email 254)
- Sanitization HTML côté affichage (`textContent` uniquement, jamais `innerHTML`)
- SQL : prepared statements D1 exclusivement (`db.prepare().bind()`)

### 5.8 Audit & observabilité
- Tous les writes loggés dans `validation_log`
- `console.log` structuré pour login success/failure et DELETE
- Tail dispo : `npx wrangler tail tayyibat-admin`

### 5.9 Out-of-scope MVP
- Pas de 2FA (Phase 2 via TOTP)
- Pas de reset password self-service (admin reset manuel via wrangler)
- Pas de signed embed URLs (iframes publiques par nature)

## 6. Plateformes vidéo

Chaque plateforme a son module `src/platforms/<plateforme>.js` qui expose :
- `parse(url)` → `{ valid, external_id, normalized_url }`
- `fetchMetadata(external_id)` → `{ title, thumbnail_url, duration_seconds, embed_url }`

| Plateforme | Parsing URL | Métadonnées |
|------------|-------------|-------------|
| **YouTube** | `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID` | oEmbed `https://www.youtube.com/oembed?url=...` (no auth) |
| **TikTok** | `tiktok.com/@user/video/ID`, `vm.tiktok.com/ID` | oEmbed `https://www.tiktok.com/oembed?url=...` (no auth) |
| **Instagram** | `instagram.com/reel/ID`, `instagram.com/p/ID` | oEmbed officiel nécessite token FB. MVP : titre = "Instagram Reel", thumbnail = placeholder, embed via blockquote |
| **Facebook** | `facebook.com/watch/?v=ID`, `fb.watch/ID` | oEmbed officiel nécessite token FB. MVP : titre = "Facebook Video", embed via iframe Plugin Video |

**Embed côté frontend** :
- YouTube : `<iframe src="https://www.youtube.com/embed/{external_id}">`
- TikTok : `<blockquote class="tiktok-embed" cite="..." data-video-id="{external_id}">` + script `https://www.tiktok.com/embed.js`
- Instagram : `<blockquote class="instagram-media" data-instgrm-permalink="{url}">` + script `https://www.instagram.com/embed.js`
- Facebook : `<iframe src="https://www.facebook.com/plugins/video.php?href={url}">`

Les scripts externes (TikTok/Instagram) ne sont chargés que sur les pages qui en ont besoin (admin détail + temoignages public, si vidéos présentes).

## 7. Structure repo

```
DrDia/repo/
├── admin.html                  ← nouveau (Pages)
├── temoignages.html            ← modifié (fetch /api/public/videos)
├── admin-worker/               ← nouveau Worker indépendant
│   ├── wrangler.toml           (bindings D1 + KV + secrets)
│   ├── package.json
│   ├── src/
│   │   ├── index.js            (router + CORS)
│   │   ├── auth.js             (JWT + PBKDF2 + middleware)
│   │   ├── rate_limit.js       (KV brute-force)
│   │   ├── routes/
│   │   │   ├── login.js
│   │   │   ├── videos.js
│   │   │   ├── users.js
│   │   │   └── public.js
│   │   └── platforms/
│   │       ├── youtube.js
│   │       ├── facebook.js
│   │       ├── instagram.js
│   │       └── tiktok.js
│   ├── migrations/
│   │   ├── 0001_init_users.sql
│   │   ├── 0002_init_videos.sql
│   │   └── 0003_seed_admin.sql
│   ├── scripts/
│   │   └── seed_testimonials.mjs
│   └── tests/
│       ├── auth.test.js
│       ├── videos.test.js
│       ├── users.test.js
│       └── platforms.test.js
```

## 8. UI/UX

### Vue Login
- Email + password + bouton "Connexion"
- Affichage rate-limit : "Réessayez dans X min" après 5 échecs
- Pas de reset password MVP

### Vue Vidéos (admin + vérificateur)
- Recherche (titre/URL), filtres (statut, plateforme), tri (date ajout/statut)
- Bouton "+ Ajouter vidéo" → modal URL unique → POST Worker → insertion `pas_valide`
- Grille cards (thumbnail, titre, plateforme badge, durée, statut badge)
- Tap card → modal détail :
  - Embed iframe live
  - Champ note (textarea)
  - Toggle statut "Marquer validé / pas validé"
  - Bouton "Supprimer" (admin only)
  - Bloc historique (validation_log)
- Pagination 30 par page

### Vue Utilisateurs (admin only)
- Liste : email, nom, dernière connexion, statut actif
- Bouton "+ Ajouter vérificateur" : email + nom + password initial
- Par ligne :
  - **"Désactiver"** (soft) → `UPDATE users SET active=0`. Bloque login, préserve toutes les references FK. Réversible via "Réactiver".
  - **"Supprimer définitivement"** (double-confirm) → `DELETE FROM users WHERE id=?`. Échoue si l'user a au moins une vidéo encore présente (FK `videos.added_by ON DELETE RESTRICT`). Admin doit d'abord transférer/supprimer ces vidéos. Une fois supprimé : `validation_log.user_id` passe à NULL (audit préservé mais anonymisé).
- L'admin **ne peut pas se supprimer** (vérif serveur sur `uid === self.id`).

## 9. Tests

### Vitest unit
- `auth.test.js` : hash/verify PBKDF2, JWT sign/verify, parsing payload expiré
- `platforms.test.js` : URL parsers (cas valides + invalides + URLs hostiles)
- `rate_limit.test.js` : compteurs KV, blocage, expiration TTL

### Vitest intégration (Miniflare D1 in-memory)
- `videos.test.js` : CRUD complet, autorisation (vérificateur ≠ DELETE), `validation_log` écrit
- `users.test.js` : admin crée/supprime vérificateur, vérificateur n'accède pas aux routes users

### E2E manuel (Playwright après deploy)
- Login `houcemben@gmail.com` → ajout vidéo YouTube → vérif apparition en `pas_valide`
- Toggle statut → vérif apparition sur `/temoignages` public
- Création vérificateur → login vérificateur → tentative DELETE → 403
- Logout admin → tentative accès `/api/videos` → 401

## 10. Migration et déploiement

### Étape 1 — Setup D1 + secrets
```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo/admin-worker
npm init -y && npm i -D wrangler vitest

npx wrangler d1 create tayyibat-admin-db
# copier le database_id retourné dans wrangler.toml

npx wrangler secret put JWT_SECRET
npx wrangler secret put INITIAL_ADMIN_PASSWORD
```

### Étape 2 — Migrations
```bash
npx wrangler d1 migrations apply tayyibat-admin-db --remote
```

### Étape 3 — Déploiement Worker
```bash
npx wrangler deploy
```

### Étape 4 — Seed des 185 vidéos
```bash
node scripts/seed_testimonials.mjs --remote
```
Script idempotent : `INSERT OR IGNORE` sur `UNIQUE(platform, external_id)`.

### Étape 5 — Déploiement Pages
```bash
cd /home/max/.botfleet/shared/projets/DrDia/repo
# Modifier temoignages.html (fetch au lieu de inline), ajouter admin.html
rm archive && \
  npx wrangler pages deploy . --project-name tayyibat --branch main --commit-dirty=true && \
  ln -s /media/max/Bake/DrDia/videos archive
```
(Note : suppression temporaire du symlink `archive` car wrangler le suit malgré `.pagesignore`, restauration après deploy. Voir contournement déjà appliqué pour le fix `/videos` du 2026-06-09.)

### Étape 6 — Smoke test E2E
Playwright manuel (cf section 9).

### Rollback
- Worker : `npx wrangler rollback <version_id>` depuis `admin-worker/`
- Pages : redéployer la version précédente via `npx wrangler pages deployment list`
- D1 : pas de rollback automatique, snapshots manuels recommandés avant migrations destructives

## 11. Out-of-scope MVP (Phase 2+)

- i18n admin (FR uniquement au lancement ; AR/EN ensuite)
- Export CSV des vidéos
- Notifications email vérificateurs sur nouvelle vidéo
- Reset password self-service (magic link via Cloudflare Email)
- Recherche full-text avancée (FTS5 sur D1)
- 2FA TOTP
- Signed embed URLs (anti hotlinking)
- Bulk operations (sélection multiple → valider/supprimer)
