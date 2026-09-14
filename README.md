# Video DL SaaS

Service de téléchargement de vidéos et de playlists à **architecture Zero-Disk** : le flux part
de la source, traverse le serveur en mémoire, et arrive dans le navigateur du client. Aucun
fichier n'est jamais écrit sur le disque du serveur, pas même dans `/tmp`.

© AZ Web Solutions

---

## Sommaire

- [Stack technique](#stack-technique)
- [Décisions d'architecture](#décisions-darchitecture)
- [Structure du projet](#structure-du-projet)
- [Démarrage rapide](#démarrage-rapide)
- [Créer le premier compte administrateur](#créer-le-premier-compte-administrateur)
- [Variables d'environnement](#variables-denvironnement)
- [Utilisation](#utilisation)
- [API](#api)
- [Base de données et migrations](#base-de-données-et-migrations)
- [Multilingue](#multilingue)
- [Plateformes nécessitant une session](#plateformes-nécessitant-une-session)
- [Développement sans Docker](#développement-sans-docker)
- [Dépannage](#dépannage)

---

## Stack technique

### Backend

| Composant | Choix | Rôle |
|---|---|---|
| Runtime | Node.js ≥ 20 (ESM) | — |
| Framework HTTP | Fastify 4 | Routage, validation de schéma, hooks |
| Base de données | PostgreSQL 16 | Utilisateurs, quotas, allowlist, contenu du site |
| Cache / compteurs | Redis 7 | Compteurs de quota atomiques, cache, pub/sub |
| Extraction média | yt-dlp (binaire figé) | Lecture des sources vidéo |
| Muxing | ffmpeg | Requis par yt-dlp |
| Runtime JS auxiliaire | Deno | Résolution du défi de signature YouTube (`nsig`) |
| Archivage | `archiver` | ZIP streamé pour les playlists |
| Authentification | `@fastify/jwt` + `bcryptjs` | Jetons access/refresh, hachage des mots de passe |
| Sécurité HTTP | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` | CSP, CORS, throttling adossé à Redis |
| Documentation | `@fastify/swagger` + `swagger-ui` | OpenAPI 3, testable depuis le navigateur |

### Frontend

| Composant | Choix |
|---|---|
| Bibliothèque | React 18 |
| Build | Vite 5 |
| Routage | react-router-dom 6 |
| Assainissement HTML | DOMPurify |
| Styles | CSS natif (custom properties, `color-mix()`) — aucun framework CSS |
| Service statique | nginx 1.27 (alpine) |

### Infrastructure

Docker Compose, quatre services : `app` (API), `web` (nginx + bundle React), `postgres`, `redis`.
Les images `app` et `web` sont construites localement ; l'API tourne en utilisateur non-root.

---

## Décisions d'architecture

Quelques choix structurants, avec leur raison — utile avant de modifier le code.

**Zero-Disk par streaming de bout en bout.** `yt-dlp -o -` écrit sur sa sortie standard, qui est
raccordée directement à la réponse HTTP. Le contre-pression (*backpressure*) est assurée par les
flux Node et le tampon de pipe de l'OS : si le client télécharge lentement, yt-dlp ralentit. La
mémoire consommée reste celle d'un tampon, pas celle d'un fichier.

**Interruption client propagée jusqu'au processus.** Une déconnexion déclenche un `AbortController`
qui envoie `SIGTERM` puis `SIGKILL` au sous-processus. Sans cela, un onglet fermé laisserait une
extraction tourner jusqu'à son terme.

**L'allowlist SSRF est en base, pas en configuration.** La table `platforms` *est* la liste blanche.
Un administrateur ajoute ou désactive une source sans redéploiement, et la désactivation prend effet
en un aller-retour Redis. Toute URL est validée avant extraction : schéma, rejet des IP littérales,
domaine dans l'allowlist, puis résolution DNS avec rejet des plages privées (RFC1918, loopback,
link-local). En cas de doute, on refuse.

**Les quotas sont vérifiés et incrémentés atomiquement.** Un script Lua Redis fait le
check-and-increment en une opération, ce qui empêche deux requêtes simultanées de passer sous la
même limite. La cascade est : bypass ADMIN → dérogation individuelle → règle du rôle → compteur.

**La validation d'URL passe avant le quota.** Une URL invalide ne doit pas consommer le quota, sinon
un invité se bloque pour un mois avec une seule requête malformée.

**Jetons en cookies `httpOnly`, pas en `localStorage`.** Un jeton lisible par JavaScript est un
jeton qu'une XSS exfiltre. Access token court (15 min) + refresh token (30 j) enregistré dans Redis,
avec rotation et détection de rejeu : rejouer un ancien refresh token détruit la session entière.

**Invalidation de cache par pub/sub.** Trois canaux Redis (`quota:invalidate`,
`sitecontent:invalidate`, `platforms:invalidate`) propagent les changements d'administration à
toutes les instances sans redémarrage.

---

## Structure du projet

```
.
├── docker-compose.yml          # Les 4 services
├── Dockerfile                  # Image API (Node + yt-dlp + ffmpeg + Deno)
├── .env.example                # Modèle de configuration — à copier en .env
├── sql/
│   └── schema.sql              # DDL complet + données initiales
├── src/
│   ├── server.js               # Assemblage Fastify, plugins, gardes de démarrage
│   ├── config.js               # Configuration centralisée (lecture d'env)
│   ├── db/pool.js              # Pool PostgreSQL
│   ├── redis/client.js         # Clients Redis + script Lua de quota
│   ├── plugins/
│   │   └── authenticate.js     # Vérifie le JWT, peuple req.user
│   ├── security/
│   │   ├── tokens.js           # Émission, rotation, révocation des jetons
│   │   ├── rbac.js             # Cascade de quotas + requireRole
│   │   ├── urlValidator.js     # Défense anti-SSRF
│   │   └── fingerprint.js      # Empreinte invité (HMAC IP + User-Agent)
│   ├── routes/
│   │   ├── auth.js             # register, login, token, refresh, logout, me
│   │   ├── download.js         # media/info, preview, download video/playlist
│   │   ├── admin.js            # Quotas, dérogations, plateformes, contenu
│   │   └── public.js           # pricing, site-content, platforms, contact
│   └── services/
│       ├── extractor.js        # Pilotage de yt-dlp
│       ├── zipStream.js        # Assemblage ZIP streamé et ordonné
│       ├── quotaService.js     # Lecture/écriture des quotas
│       ├── platformService.js  # Allowlist SSRF
│       └── siteContentService.js # Contenu éditable, multilingue
└── frontend/
    ├── Dockerfile              # Build Vite → nginx
    ├── nginx.conf              # En-têtes de sécurité + cache
    └── src/
        ├── main.jsx            # Montage + providers
        ├── App.jsx             # Routes
        ├── api.js              # Client HTTP (refresh auto sur 401)
        ├── i18n.js             # Libellés d'interface FR/EN
        ├── LanguageContext.jsx # Langue courante
        ├── AuthContext.jsx     # Session et quota
        ├── SiteContentContext.jsx # Contenu éditable par l'admin
        ├── components/
        └── pages/
```

---

## Démarrage rapide

**Prérequis :** Docker et Docker Compose. Rien d'autre — Node, PostgreSQL et Redis tournent dans
les conteneurs.

### 1. Configuration

```bash
cp .env.example .env
```

Puis générez les deux secrets et mettez-les dans `.env` :

```bash
openssl rand -base64 48   # → COOKIE_SECRET
openssl rand -base64 48   # → JWT_SECRET
```

Renseignez aussi `POSTGRES_PASSWORD`. En local sans HTTPS, mettez `COOKIE_SECURE=false`, sinon le
navigateur refusera les cookies et la connexion échouera silencieusement.

> Le démarrage **échoue volontairement** si `COOKIE_SECRET` ou `JWT_SECRET` sont absents, et refuse
> de démarrer en production s'ils valent encore la valeur par défaut. Une clé JWT prévisible
> permettrait à n'importe qui de forger un jeton ADMIN.

### 2. Lancement

```bash
docker compose up -d --build
```

Au premier démarrage, `sql/schema.sql` est appliqué automatiquement et crée les tables, les quotas
par rôle, l'allowlist de plateformes et tout le contenu du site en français et en anglais.

### 3. Accès

| Service | URL |
|---|---|
| Site et application | http://localhost:3000 |
| API | http://localhost:8080 |
| Documentation Swagger | http://localhost:8080/docs |
| Santé | http://localhost:8080/healthz |

### Commandes courantes

```bash
docker compose ps                      # État des services
docker compose logs -f app             # Journaux de l'API
docker compose up -d --build app web   # Reconstruire après modification du code
docker compose down                    # Arrêter (les données sont conservées)
docker compose down -v                 # Arrêter ET effacer la base — destructif
```

---

## Créer le premier compte administrateur

**L'inscription crée toujours un compte `FREE_USER`.** Il n'existe volontairement aucune route qui
accorde le rôle ADMIN, et aucun compte administrateur n'est créé au démarrage : un identifiant par
défaut dans une image publique serait une porte ouverte.

Le premier administrateur se promeut donc en base :

```bash
# 1. Inscrivez-vous normalement sur http://localhost:3000/register
# 2. Promouvez ce compte :
docker compose exec -T postgres psql -U app -d video_dl \
  -c "UPDATE users SET role = 'ADMIN' WHERE email = 'vous@exemple.com';"
```

Reconnectez-vous ensuite : le rôle est porté par l'access token, il est donc rafraîchi au plus tard
au bout de 15 minutes, ou immédiatement après une nouvelle connexion. Le lien **Admin** apparaît
alors dans la barre de navigation.

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `COOKIE_SECRET` | *(requis)* | Signature des cookies. Chaîne aléatoire longue. |
| `JWT_SECRET` | *(requis)* | Signature des jetons. **La faire tourner déconnecte tout le monde** — c'est le levier d'urgence en cas de compromission. |
| `POSTGRES_PASSWORD` | `app` | Mot de passe PostgreSQL. |
| `COOKIE_SECURE` | `true` | `false` uniquement en HTTP local. |
| `ACCESS_TOKEN_TTL` | `900` | Durée de l'access token (s). C'est aussi le délai maximal avant qu'un bannissement ou un changement de rôle prenne effet. |
| `REFRESH_TOKEN_TTL` | `2592000` | Durée du refresh token (s), soit 30 jours. |
| `EXPOSE_DOCS` | `true` | Expose `/docs`. **Mettre à `false` en production** : Swagger publie toute la surface d'API. |
| `FRONTEND_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Origines autorisées en CORS avec cookies. |
| `TRUSTED_PROXY_COUNT` | `1` | Nombre de reverse-proxies de confiance (Cloudflare, nginx). Ne jamais faire confiance aveuglément à `X-Forwarded-For`. |
| `VITE_API_URL` | `http://localhost:8080` | **Compilé dans le bundle.** Doit être joignable depuis le *navigateur*, donc jamais `app:8080`. |
| `PLAYLIST_PROBE_HARD_CAP` | `100` | Plafond d'entrées énumérées lors de l'aperçu d'une playlist. |
| `PROBE_TIMEOUT_MS` | `45000` | Délai maximal d'une analyse de lien. |
| `COOKIES_HOST_PATH` | *(vide)* | Chemin hôte d'un fichier de cookies Netscape. |
| `YTDLP_COOKIES_FILE` | *(vide)* | Chemin du même fichier dans le conteneur. |

---

## Utilisation

### Côté visiteur

1. Coller un lien (vidéo, short, reel ou playlist) sur **Ouvrir l'app**.
2. **Analyser le lien** : titre, durée, miniature et qualités réellement disponibles sont lus à la
   source. Pour une playlist, la liste des vidéos s'affiche avec des cases à cocher.
3. Choisir la qualité, et pour une playlist les vidéos à inclure.
4. **Télécharger** : le flux démarre immédiatement, sans attente de traitement côté serveur.

Les quotas par défaut :

| Rôle | Téléchargements / mois | Playlists | Résolution | Flux simultanés |
|---|---|---|---|---|
| `GUEST` | 1 (30 j glissants) | — | 480p | 1 |
| `FREE_USER` | 20 | 5 vidéos | 720p | 1 |
| `PREMIUM` | illimité | 200 vidéos | 4k | 2 |
| `ADMIN` | illimité | illimité | 4k | 8 |

Ces valeurs sont modifiables à chaud depuis l'administration ; celles-ci sont les valeurs initiales.

### Côté administrateur

L'onglet **Admin** regroupe :

- **Quotas par rôle** — modifiables sans redéploiement, propagés par pub/sub Redis.
- **Dérogations individuelles** — limite sur mesure ou illimitée pour un utilisateur, avec date
  d'expiration facultative.
- **Plateformes** — c'est l'allowlist SSRF elle-même. Ajouter une ligne rend un site téléchargeable,
  en désactiver une coupe les extractions immédiatement. La colonne « Session requise » signale les
  plateformes qui refusent les requêtes anonymes.
- **Contenu du site** — chaque texte des pages publiques, en JSON, avec un onglet par langue.
- **Messages de contact** — reçus via le formulaire public.

---

## API

Documentation interactive sur `/docs` (quand `EXPOSE_DOCS=true`).

### Authentification dans Swagger

Deux méthodes :

1. **Cookie de session** — exécuter `POST /api/auth/login` depuis la page. Les docs étant servies
   sur la même origine que l'API, le navigateur conserve les cookies et les renvoie sur tous les
   appels suivants. Les routes verrouillées se débloquent d'elles-mêmes.
2. **Jeton bearer** — `POST /api/auth/token` avec les mêmes identifiants renvoie un `accessToken`
   à coller dans le bouton **Authorize**. C'est la voie pour curl, Postman ou un client maison.

> Le champ `cookieAuth` du dialogue Authorize ne peut rien faire : un navigateur interdit à un
> script de poser un en-tête `Cookie`. Laissez-le vide et utilisez l'une des deux méthodes ci-dessus.

### Routes principales

**Authentification**

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Inscription (crée un `FREE_USER`) |
| `POST` | `/api/auth/login` | Connexion, pose les cookies |
| `POST` | `/api/auth/token` | Jeton bearer pour client non-navigateur |
| `POST` | `/api/auth/refresh` | Rotation des jetons |
| `POST` | `/api/auth/logout` | Révoque la session côté serveur |
| `GET` | `/api/auth/me` | Session et quota courants (répond aussi aux invités) |

**Téléchargement**

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/media/info?url=` | Analyse universelle d'un lien |
| `GET` | `/api/playlist/preview?url=` | Aperçu d'une playlist |
| `GET` | `/api/download/video?url=&resolution=` | Flux vidéo direct |
| `GET` | `/api/download/playlist?url=&select=` | ZIP streamé |

**Public**

`GET /api/pricing` · `GET /api/site-content?lang=` · `GET /api/platforms` · `GET /api/languages` ·
`POST /api/contact`

**Administration** (rôle `ADMIN`)

`GET /api/admin/users` · `GET|PATCH /api/admin/quotas[/:role]` ·
`POST|DELETE /api/admin/overrides[/:userId]` ·
`GET|POST|PATCH|DELETE /api/admin/platforms[/:id]` ·
`GET|PATCH /api/admin/site-content[/:section]` · `GET /api/admin/contact-messages`

### Codes de réponse à connaître

| Code | Signification |
|---|---|
| `401` | Non authentifié, ou access token expiré — **récupérable** via `/api/auth/refresh` |
| `403` | Authentifié mais rôle insuffisant — non récupérable |
| `422` | Lien illisible, privé, ou plateforme exigeant une session (voir `reason`) |
| `429` | Quota mensuel atteint, ou throttling |

---

## Base de données et migrations

> **À connaître absolument.** `sql/schema.sql` n'est appliqué que lorsque le volume PostgreSQL est
> **vide** — c'est la convention de l'image officielle. Modifier ce fichier n'a **aucun effet** sur
> une base déjà initialisée.

Pour une base existante, appliquez le changement à la main :

```bash
docker compose exec -T postgres psql -U app -d video_dl -v ON_ERROR_STOP=1 < ma_migration.sql
```

Et répercutez-le également dans `sql/schema.sql`, pour qu'une installation neuve parte du même état.

Pour repartir de zéro en développement (**efface toutes les données**) :

```bash
docker compose down -v && docker compose up -d --build
```

### Tables

| Table | Rôle |
|---|---|
| `users` | Comptes, rôle, statut |
| `tier_quotas` | Limites par rôle, modifiables à chaud |
| `user_quota_overrides` | Dérogations individuelles, expirables |
| `platforms` | Allowlist SSRF + métadonnées d'affichage |
| `download_logs` | Journal d'usage (survit à la suppression d'un compte, anonymisé) |
| `site_content` | Textes des pages publiques, clé `(section, lang)` |
| `contact_messages` | Formulaire de contact |

Les colonnes d'audit (`updated_by`, `created_by`) sont en `ON DELETE SET NULL` : la suppression d'un
compte ne doit jamais être bloquée par une trace d'audit, sous peine d'empêcher l'exercice du droit
à l'effacement. La ligne survit, l'auteur est oublié.

---

## Multilingue

Le site est disponible en **français** (défaut) et en **anglais**, via le sélecteur de la barre de
navigation. Le choix est mémorisé ; à la première visite, la langue du navigateur est détectée.

Deux sources distinctes, volontairement :

- **Contenu éditorial** → table `site_content`, clé `(section, lang)`, modifiable depuis
  l'administration sans redéploiement.
- **Libellés d'interface** → `frontend/src/i18n.js` (boutons, en-têtes de tableau, messages de
  validation). Ces chaînes-là n'ont pas à être confiées à un éditeur non technique.

Une section non traduite **retombe automatiquement sur le français** plutôt que d'afficher une page
vide : une langue peut donc être ajoutée progressivement.

### Ajouter une langue

1. Ajouter le code dans `SUPPORTED_LANGS` (`src/services/siteContentService.js`).
2. Ajouter le dictionnaire correspondant dans `frontend/src/i18n.js` et l'entrée dans `LANGUAGES`.
3. Insérer les lignes `site_content` pour cette langue, ou les saisir depuis l'administration
   (l'onglet de langue pré-remplit à partir du français).

> Le tableau de bord d'administration est en français uniquement — c'est de l'outillage opérateur,
> pas une page publique.

---

## Plateformes nécessitant une session

Instagram et Facebook refusent les requêtes anonymes ; l'extraction échoue systématiquement sans
session connectée. C'est un fait vérifié, pas une supposition : Facebook renvoie une page de
connexion déguisée en HTTP 200.

Ces plateformes sont marquées `requires_auth` : elles restent visibles avec la mention « session
requise », et une tentative renvoie un message explicite plutôt qu'une erreur générique.

Pour les activer, fournissez un export de cookies au format Netscape :

```bash
# Dans .env
COOKIES_HOST_PATH=/chemin/absolu/vers/cookies.txt
YTDLP_COOKIES_FILE=/run/secrets/cookies.txt
```

Le fichier est monté **en lecture seule** dans le conteneur. Il n'est jamais stocké en base ni
saisissable depuis l'interface web : un identifiant de session dans une table est un identifiant de
session qui fuit avec la table.

**Fonctionnent sans session :** YouTube (vidéos, Shorts, playlists), TikTok, Vimeo, Dailymotion,
Reddit, Twitch, X/Twitter.

---

## Développement sans Docker

Il faut une instance PostgreSQL et une instance Redis joignables, ainsi que `yt-dlp` et `ffmpeg`
dans le `PATH`.

```bash
# API — rechargement à chaud
npm install
npm run dev

# Frontend — serveur de développement Vite sur :5173
cd frontend
npm install
npm run dev
```

`http://localhost:5173` figure déjà dans les origines CORS par défaut.

---

## Dépannage

**« Route GET:/ not found » sur le port 8080** — normal : l'API n'est pas le site. Le site est sur
le port 3000.

**La connexion semble réussir mais l'utilisateur reste déconnecté** — en HTTP local, `COOKIE_SECURE`
doit valoir `false`, sinon le navigateur rejette les cookies sans le signaler.

**Le navigateur sert une ancienne version de l'interface** — `docker compose up -d --build web`,
puis rechargement forcé. nginx est configuré pour ne pas mettre `index.html` en cache, mais un
onglet déjà ouvert peut conserver l'ancien bundle.

**Une modification de `sql/schema.sql` reste sans effet** — voir
[Base de données et migrations](#base-de-données-et-migrations) : le fichier n'est lu qu'au premier
démarrage.

**« Requested format is not available » sur YouTube** — les protections anti-robot de YouTube
évoluent en permanence. Le contournement passe par la version de yt-dlp figée dans le `Dockerfile`
(`ARG YTDLP_VERSION`) : la relever puis reconstruire est en général le correctif.

**Le téléchargement repasse en quota invité** — l'access token a expiré et la navigation ne l'a pas
renouvelé. Le front rafraîchit avant de lancer le téléchargement ; si le problème persiste, vérifiez
que `/api/auth/refresh` répond bien 200.

**`ECONNREFUSED` vers PostgreSQL ou Redis au démarrage** — les dépendances attendent le `healthcheck`,
mais un premier lancement peut être plus lent. `docker compose logs app` puis
`docker compose restart app`.
