-- =====================================================================
-- Zero-Disk Video/Playlist Download SaaS — PostgreSQL schema
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- case-insensitive email

CREATE TYPE user_role AS ENUM ('GUEST', 'FREE_USER', 'PREMIUM', 'ADMIN');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE media_kind AS ENUM ('VIDEO', 'AUDIO', 'PLAYLIST_ZIP');

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'FREE_USER',
    status          account_status NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------
-- tier_quotas — one row per role, hot-editable by ADMIN, cached in Redis
-- ---------------------------------------------------------------------
CREATE TABLE tier_quotas (
    role                    user_role PRIMARY KEY,
    monthly_download_limit  INTEGER NOT NULL DEFAULT 0, -- -1 = unlimited
    max_playlist_items      INTEGER NOT NULL DEFAULT 0, -- 0 = playlists disabled
    allow_hd                BOOLEAN NOT NULL DEFAULT FALSE,
    max_resolution          TEXT NOT NULL DEFAULT '480p',
    max_concurrent_streams  INTEGER NOT NULL DEFAULT 1,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- SET NULL, not the default NO ACTION: these audit columns must never
    -- make an admin account undeletable. Without this, deleting an admin
    -- who ever edited a quota fails on the FK, which blocks GDPR erasure.
    -- Same reasoning as download_logs.user_id — the row survives, the
    -- actor is simply forgotten.
    updated_by              UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO tier_quotas (role, monthly_download_limit, max_playlist_items, allow_hd, max_resolution, max_concurrent_streams) VALUES
    ('GUEST',      1,   0,   FALSE, '480p',  1),
    ('FREE_USER',  20,  5,   FALSE, '720p',  1),
    ('PREMIUM',    -1,  200, TRUE,  '4k',    2),
    ('ADMIN',      -1,  -1,  TRUE,  '4k',    8);

-- ---------------------------------------------------------------------
-- platforms — the SSRF source allowlist itself, admin-managed.
-- Lives in the DB (not config.js) so an admin can add or disable a
-- platform without a redeploy, while "deny by default" still holds:
-- a host matching no enabled row is rejected before any extraction.
-- ---------------------------------------------------------------------
CREATE TABLE platforms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    domains     TEXT[] NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE when the platform refuses anonymous requests and only works
    -- with a logged-in session (see YTDLP_COOKIES_FILE). Surfaced in the
    -- UI so the product never advertises a source that always fails.
    requires_auth BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_platforms_enabled ON platforms (enabled) WHERE enabled;

-- requires_auth reflects verified yt-dlp behaviour, not guesswork:
-- Instagram returns "empty media response ... use --cookies" anonymously,
-- and Facebook gates reels the same way. TikTok is inconsistent (public
-- videos often work), so it is deliberately NOT flagged.
INSERT INTO platforms (slug, name, domains, enabled, requires_auth, notes) VALUES
    ('youtube',     'YouTube',     ARRAY['youtube.com','youtu.be','m.youtube.com','music.youtube.com'], TRUE,  FALSE, 'Vidéos, Shorts, playlists'),
    ('vimeo',       'Vimeo',       ARRAY['vimeo.com','player.vimeo.com'],                               TRUE,  FALSE, 'Vidéos publiques'),
    ('dailymotion', 'Dailymotion', ARRAY['dailymotion.com','dai.ly'],                                   TRUE,  FALSE, 'Vidéos publiques'),
    ('instagram',   'Instagram',   ARRAY['instagram.com','instagr.am','ddinstagram.com'],               TRUE,  TRUE,  'Exige une session connectée (cookies) — Instagram refuse les requêtes anonymes'),
    ('facebook',    'Facebook',    ARRAY['facebook.com','fb.watch','fb.com','m.facebook.com'],          TRUE,  TRUE,  'Reels : exige une session connectée (cookies). Certaines vidéos publiques passent sans.'),
    ('tiktok',      'TikTok',      ARRAY['tiktok.com','vm.tiktok.com','vt.tiktok.com'],                 TRUE,  FALSE, 'Vidéos publiques'),
    ('twitter',     'X / Twitter', ARRAY['twitter.com','x.com','t.co'],                                 TRUE,  FALSE, 'Vidéos de posts publics'),
    ('reddit',      'Reddit',      ARRAY['reddit.com','redd.it','v.redd.it'],                           TRUE,  FALSE, 'Vidéos hébergées par Reddit'),
    ('twitch',      'Twitch',      ARRAY['twitch.tv','clips.twitch.tv'],                                TRUE,  FALSE, 'Clips et VODs'),
    ('soundcloud',  'SoundCloud',  ARRAY['soundcloud.com','snd.sc'],                                    FALSE, FALSE, 'Audio — désactivé par défaut');

-- ---------------------------------------------------------------------
-- user_quota_overrides — per-user arbitrary/unlimited quota, time-boxed
-- ---------------------------------------------------------------------
CREATE TABLE user_quota_overrides (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    custom_monthly_limit INTEGER NOT NULL, -- -1 = unlimited
    reason               TEXT,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ, -- NULL = never expires

    CONSTRAINT uq_active_override UNIQUE (user_id) -- one active override per user
);

-- No extra index needed for user_id lookups: the UNIQUE(user_id) constraint
-- above already provides one. A partial index filtered on `now()` is not
-- possible in Postgres since index predicates must be IMMUTABLE.

-- ---------------------------------------------------------------------
-- download_logs — audit trail / usage metering (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE download_logs (
    id                    BIGSERIAL PRIMARY KEY,
    user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
    guest_fingerprint_hash TEXT,
    source_url            TEXT NOT NULL,
    media_type            media_kind NOT NULL,
    resolution            TEXT,
    duration_seconds      INTEGER,
    bytes_transferred     BIGINT NOT NULL DEFAULT 0,
    completed             BOOLEAN NOT NULL DEFAULT FALSE,
    abort_reason          TEXT, -- e.g. 'client_disconnect', 'quota_exceeded', 'ssrf_blocked'
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()

    -- NOTE: there is deliberately no CHECK requiring an actor.
    -- An earlier version had CHECK (user_id IS NOT NULL OR
    -- guest_fingerprint_hash IS NOT NULL), which made deleting a user
    -- IMPOSSIBLE: the FK's ON DELETE SET NULL nulls user_id, leaving both
    -- columns NULL and violating the check, so the DELETE aborted. That
    -- blocked account deletion / GDPR erasure entirely.
    --
    -- Both-NULL is now the intended "account since deleted" state: the
    -- usage row survives for aggregate metering while the identity is
    -- gone. Insert-time presence of an actor is guaranteed by the
    -- application (routes/download.js always passes one of the two).
);

-- Monthly usage counting (billing period = calendar month, matches Redis TTL logic)
CREATE INDEX idx_download_logs_user_month
    ON download_logs (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_download_logs_guest_month
    ON download_logs (guest_fingerprint_hash, created_at DESC)
    WHERE guest_fingerprint_hash IS NOT NULL;

CREATE INDEX idx_download_logs_created_at ON download_logs (created_at DESC);

-- ---------------------------------------------------------------------
-- contact_messages — public "Contact us" form submissions
-- ---------------------------------------------------------------------
CREATE TABLE contact_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       CITEXT NOT NULL,
    subject     TEXT,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_messages_created_at ON contact_messages (created_at DESC);

-- ---------------------------------------------------------------------
-- site_content — every piece of marketing copy on the public site,
-- editable by ADMIN without a redeploy (one JSON blob per page section,
-- per language).
--
-- One row per (section, language) rather than one row holding every
-- translation: a language is then added by inserting rows, never by
-- rewriting the shape of existing JSON, and an admin editing the English
-- copy cannot accidentally clobber the French. Missing translations fall
-- back to DEFAULT_LANG at read time (see services/siteContentService.js),
-- so a half-translated site degrades to the original language instead of
-- rendering blank sections.
-- ---------------------------------------------------------------------
CREATE TABLE site_content (
    section     TEXT NOT NULL,
    lang        TEXT NOT NULL DEFAULT 'fr',
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (section, lang),
    CONSTRAINT chk_lang CHECK (lang ~ '^[a-z]{2}$')
);

INSERT INTO site_content (section, data) VALUES
('landing', $json${
  "eyebrow": "Architecture Zero-Disk",
  "title": "Téléchargez vidéos et playlists sans jamais toucher notre disque",
  "subtitle": "Un SaaS de téléchargement qui streame directement la source vers vous : rien n'est stocké, rien ne traîne. Sécurisé par design, contrôlé par rôle.",
  "ctaPrimaryLabel": "Commencer gratuitement",
  "ctaSecondaryLabel": "Essayer sans compte",
  "hint": "1 vidéo gratuite sans inscription · aucune carte bancaire requise",
  "stepsTitle": "Comment ça marche",
  "steps": [
    { "title": "Collez une URL", "desc": "Vidéo ou playlist YouTube, Vimeo, Dailymotion." },
    { "title": "Choisissez", "desc": "Résolution, et pour les playlists, les vidéos précises à inclure." },
    { "title": "Recevez le fichier", "desc": "Le flux démarre immédiatement, sans attente de traitement côté serveur." }
  ],
  "ctaBandTitle": "Prêt à essayer ?",
  "ctaBandText": "Créez un compte gratuit — aucune carte bancaire requise.",
  "ctaBandButtonLabel": "Créer mon compte"
}$json$::jsonb),

('pricing', $json${
  "eyebrow": "Tarifs",
  "title": "Un plan simple, qui grandit avec vous",
  "subtitle": "Commencez gratuitement, passez à Premium quand les playlists et la HD deviennent indispensables.",
  "free": { "name": "Gratuit", "price": "0€", "sub": "Pour découvrir le service", "ctaLabel": "Commencer" },
  "premium": { "name": "Premium", "price": "9,99€", "priceSuffix": "/mois", "sub": "Pour un usage intensif", "ctaLabel": "Contacter l'administrateur", "extraFeatures": ["Support prioritaire"] },
  "enterprise": {
    "name": "Entreprise",
    "price": "Sur mesure",
    "sub": "Volumes élevés, API dédiée, SLA",
    "ctaLabel": "Nous contacter",
    "features": ["Quotas personnalisés", "Accès API prioritaire", "Support dédié", "Facturation entreprise"]
  },
  "compareTitle": "Comparatif détaillé"
}$json$::jsonb),

('about', $json${
  "eyebrow": "À propos",
  "title": "Une architecture pensée pour la confidentialité",
  "intro": "Video DL SaaS est développé par <strong>AZ Web Solutions</strong>. Notre conviction : un service qui manipule du contenu vidéo pour des tiers ne devrait jamais avoir besoin de le stocker pour fonctionner.",
  "sections": [
    { "title": "Pourquoi le Zero-Disk ?", "text": "La plupart des outils de téléchargement écrivent le fichier sur un serveur avant de vous le transmettre — ce qui veut dire stockage temporaire, files d'attente, et une surface d'attaque supplémentaire. Nous avons construit le pipeline dans l'autre sens : le flux part de la source, traverse notre serveur en mémoire, et arrive chez vous. Rien n'est écrit, rien ne persiste." },
    { "title": "Sécurité par construction", "text": "Chaque URL passe par une validation stricte (liste blanche de domaines, résolution DNS vérifiée) avant qu'aucune extraction ne démarre, pour empêcher toute requête vers des adresses internes ou privées. Les quotas sont appliqués de façon atomique, rôle par rôle, pour éviter les abus sans pénaliser les usages légitimes." }
  ],
  "beliefsTitle": "Ce que nous croyons",
  "beliefs": [
    { "title": "Transparence technique", "text": "Notre documentation API est publique et testable — pas de boîte noire." },
    { "title": "Respect des plateformes sources", "text": "Nous rappelons à chaque utilisateur de ne télécharger que du contenu dont il détient les droits ou l'autorisation, dans le respect des conditions d'utilisation des plateformes d'origine." },
    { "title": "Sobriété d'infrastructure", "text": "Pas de stockage à faire évoluer, pas de fichiers orphelins à nettoyer." }
  ]
}$json$::jsonb),

('faq', $json${
  "eyebrow": "FAQ",
  "title": "Questions fréquentes",
  "items": [
    { "q": "Est-ce légal de télécharger des vidéos avec ce service ?", "a": "Le service est un outil technique : à vous de vous assurer que vous avez le droit de télécharger le contenu visé (contenu dont vous êtes l'auteur, sous licence libre, ou pour un usage autorisé par la plateforme source). Respectez les conditions d'utilisation des plateformes d'origine." },
    { "q": "Que se passe-t-il si mon quota mensuel est atteint ?", "a": "Vous recevez une erreur claire indiquant la limite de votre plan. Le compteur se réinitialise au début du mois suivant (ou 30 jours glissants pour les invités). Vous pouvez passer à un plan supérieur à tout moment depuis la page Tarifs." },
    { "q": "Quelles plateformes sont supportées ?", "a": "YouTube, Vimeo et Dailymotion actuellement. Toute autre URL est rejetée avant extraction, par sécurité (protection anti-SSRF)." },
    { "q": "Le service stocke-t-il mes vidéos quelque part ?", "a": "Non. L'architecture est \"Zero-Disk\" : chaque octet transite en flux direct depuis la source vers votre navigateur, sans jamais être écrit sur nos serveurs, même temporairement." },
    { "q": "Puis-je choisir certaines vidéos dans une playlist plutôt que tout télécharger ?", "a": "Oui. L'aperçu de playlist liste les vidéos avec miniature et durée ; vous cochez celles que vous voulez et seules celles-ci sont incluses dans le .zip généré." },
    { "q": "Puis-je annuler mon abonnement Premium à tout moment ?", "a": "Oui, sans engagement ni préavis. Contactez-nous depuis la page Contact pour toute question de facturation." },
    { "q": "Proposez-vous un accès API pour intégrer le service ailleurs ?", "a": "Oui, toute l'API est documentée et testable via Swagger (lien \"API Docs\"). Les comptes Entreprise bénéficient d'un accès prioritaire." }
  ]
}$json$::jsonb),

('contact', $json${
  "eyebrow": "Contact",
  "title": "Une question, un projet Entreprise ?",
  "subtitle": "Écrivez-nous — nous répondons généralement sous 1 jour ouvré.",
  "successTitle": "Message envoyé",
  "successText": "Merci, nous revenons vers vous rapidement."
}$json$::jsonb),

('footer', $json${
  "tagline": "Téléchargement de vidéos et playlists en streaming direct, sans stockage disque.",
  "copyright": "AZ Web Solutions. Tous droits réservés."
}$json$::jsonb),

-- Cookie policy. The table below describes the cookies this application
-- actually sets (see plugins/authenticate.js and security/tokens.js) —
-- it is not boilerplate, and it must be updated when those change.
--
-- Every entry is exempt from consent under the ePrivacy directive and
-- CNIL guidance: authentication cookies are strictly necessary, and the
-- guest cookie falls squarely under the published exemption for cookies
-- that cap free access to a sample of content. That is why the site shows
-- an information notice rather than an accept/reject gate — a "reject"
-- button that cannot actually disable anything is a dark pattern. Add a
-- real consent mechanism the day a non-exempt cookie is introduced
-- (analytics, advertising, embedded third-party players).
('cookies', $json${
  "eyebrow": "Confidentialité",
  "title": "Politique de cookies",
  "updatedAt": "12 septembre 2026",
  "intro": "Ce site n'utilise que des cookies strictement nécessaires à son fonctionnement. Aucun cookie publicitaire, aucun traceur tiers, aucune mesure d'audience. Nous ne vendons ni ne partageons aucune donnée.",
  "noticeText": "Nous utilisons uniquement des cookies essentiels au fonctionnement du service (connexion et comptage du quota gratuit). Aucun traceur publicitaire.",
  "noticeDismiss": "J'ai compris",
  "noticeMore": "Politique de cookies",
  "consentNote": "Ces cookies étant strictement nécessaires au service que vous demandez, votre consentement n'est pas requis — la réglementation impose en revanche de vous en informer clairement, ce que fait cette page. Si nous ajoutions un jour un outil de mesure d'audience ou de publicité, un véritable choix vous serait demandé au préalable.",
  "categories": [
    {
      "name": "Cookies strictement nécessaires",
      "status": "Toujours actifs · consentement non requis",
      "description": "Sans eux, la connexion à votre compte et l'application du quota gratuit sont impossibles.",
      "cookies": [
        {
          "name": "at",
          "purpose": "Jeton d'authentification. Vous identifie pendant votre session.",
          "duration": "15 minutes",
          "note": "Inaccessible au JavaScript (httpOnly)"
        },
        {
          "name": "rt",
          "purpose": "Jeton de renouvellement. Vous évite de vous reconnecter à chaque visite.",
          "duration": "30 jours",
          "note": "Inaccessible au JavaScript (httpOnly), limité aux routes d'authentification"
        },
        {
          "name": "has_session",
          "purpose": "Indicateur technique signalant à l'interface qu'une session existe, pour éviter de vous afficher comme déconnecté à tort.",
          "duration": "30 jours",
          "note": "Ne contient que la valeur 1, aucune donnée personnelle"
        },
        {
          "name": "gsid",
          "purpose": "Identifie votre navigateur afin de décompter la vidéo gratuite accordée aux visiteurs non inscrits.",
          "duration": "30 jours",
          "note": "Identifiant aléatoire, sans lien avec votre identité"
        }
      ]
    }
  ],
  "storage": {
    "title": "Stockage local",
    "body": "Votre navigateur mémorise le fait que vous avez fermé le bandeau d'information, afin de ne pas le réafficher à chaque page. Cette information reste sur votre appareil et ne nous est jamais transmise."
  },
  "serverSide": {
    "title": "Données traitées côté serveur",
    "body": "Pour appliquer la limite de téléchargement gratuit aux visiteurs non inscrits, nous combinons votre adresse IP et votre type de navigateur en une empreinte chiffrée (HMAC-SHA256). Cette empreinte est irréversible : nous ne conservons ni votre adresse IP ni votre navigateur en clair, et cette empreinte ne sert qu'au comptage du quota. Base légale : intérêt légitime à prévenir l'abus de l'offre gratuite."
  },
  "rights": {
    "title": "Vos droits",
    "body": "Vous pouvez à tout moment supprimer ces cookies depuis les réglages de votre navigateur ; vous serez alors déconnecté et le quota invité repartira de zéro. Vous disposez d'un droit d'accès, de rectification, d'effacement et d'opposition sur vos données. Pour l'exercer, contactez-nous.",
    "ctaLabel": "Nous contacter"
  }
}$json$::jsonb);

-- ---------------------------------------------------------------------
-- English translations. Same section keys and same JSON shape as the
-- rows above — the pages read identical fields, only the copy differs.
-- A section omitted here simply falls back to French at read time, so
-- this list may be completed progressively.
-- ---------------------------------------------------------------------
INSERT INTO site_content (section, lang, data) VALUES
('landing', 'en', $json${
  "eyebrow": "Zero-Disk Architecture",
  "title": "Download videos and playlists without ever touching our disk",
  "subtitle": "A download service that streams straight from the source to you: nothing is stored, nothing lingers. Secure by design, controlled by role.",
  "ctaPrimaryLabel": "Start for free",
  "ctaSecondaryLabel": "Try without an account",
  "hint": "1 free video, no sign-up · no credit card required",
  "stepsTitle": "How it works",
  "steps": [
    { "title": "Paste a URL", "desc": "A video or playlist from YouTube, Vimeo, Dailymotion." },
    { "title": "Choose", "desc": "Resolution, and for playlists, exactly which videos to include." },
    { "title": "Get your file", "desc": "The stream starts immediately — no waiting for server-side processing." }
  ],
  "ctaBandTitle": "Ready to try it?",
  "ctaBandText": "Create a free account — no credit card required.",
  "ctaBandButtonLabel": "Create my account"
}$json$::jsonb),

('pricing', 'en', $json${
  "eyebrow": "Pricing",
  "title": "One simple plan that grows with you",
  "subtitle": "Start free, move to Premium when playlists and HD become essential.",
  "free": { "name": "Free", "price": "€0", "sub": "To discover the service", "ctaLabel": "Get started" },
  "premium": { "name": "Premium", "price": "€9.99", "priceSuffix": "/month", "sub": "For heavy use", "ctaLabel": "Contact the admin", "extraFeatures": ["Priority support"] },
  "enterprise": {
    "name": "Enterprise",
    "price": "Custom",
    "sub": "High volume, dedicated API, SLA",
    "ctaLabel": "Contact us",
    "features": ["Custom quotas", "Priority API access", "Dedicated support", "Business invoicing"]
  },
  "compareTitle": "Detailed comparison"
}$json$::jsonb),

('about', 'en', $json${
  "eyebrow": "About",
  "title": "An architecture built for privacy",
  "intro": "Video DL SaaS is built by <strong>AZ Web Solutions</strong>. Our conviction: a service that handles video on someone else''s behalf should never need to store it in order to work.",
  "sections": [
    { "title": "Why Zero-Disk?", "text": "Most download tools write the file to a server before handing it to you — which means temporary storage, queues, and one more attack surface. We built the pipeline the other way round: the stream leaves the source, passes through our server in memory, and arrives at your browser. Nothing is written, nothing persists." },
    { "title": "Security by construction", "text": "Every URL goes through strict validation (domain allowlist, verified DNS resolution) before any extraction starts, to block requests aimed at internal or private addresses. Quotas are enforced atomically, role by role, to prevent abuse without penalising legitimate use." }
  ],
  "beliefsTitle": "What we believe",
  "beliefs": [
    { "title": "Technical transparency", "text": "Our API documentation is public and testable — no black box." },
    { "title": "Respect for source platforms", "text": "We remind every user to download only content they own or are authorised to use, in line with the terms of the originating platforms." },
    { "title": "Lean infrastructure", "text": "No storage to scale, no orphaned files to clean up." }
  ]
}$json$::jsonb),

('faq', 'en', $json${
  "eyebrow": "FAQ",
  "title": "Frequently asked questions",
  "items": [
    { "q": "Is it legal to download videos with this service?", "a": "The service is a technical tool: it is up to you to make sure you have the right to download the content in question (content you created, openly licensed content, or use permitted by the source platform). Please respect the terms of the originating platforms." },
    { "q": "What happens when I reach my monthly quota?", "a": "You get a clear error stating your plan''s limit. The counter resets at the start of the next month (or on a rolling 30-day window for guests). You can upgrade at any time from the Pricing page." },
    { "q": "Which platforms are supported?", "a": "YouTube, Vimeo and Dailymotion at present. Any other URL is rejected before extraction, as a safety measure (SSRF protection)." },
    { "q": "Does the service store my videos anywhere?", "a": "No. The architecture is Zero-Disk: every byte streams directly from the source to your browser, and is never written to our servers, not even temporarily." },
    { "q": "Can I pick certain videos from a playlist instead of downloading everything?", "a": "Yes. The playlist preview lists each video with its thumbnail and duration; you tick the ones you want and only those are included in the generated .zip." },
    { "q": "Can I cancel my Premium subscription at any time?", "a": "Yes, with no commitment and no notice period. Contact us from the Contact page for any billing question." },
    { "q": "Do you offer API access to integrate the service elsewhere?", "a": "Yes, the whole API is documented and testable through Swagger (the \"API Docs\" link). Enterprise accounts get priority access." }
  ]
}$json$::jsonb),

('contact', 'en', $json${
  "eyebrow": "Contact",
  "title": "A question, or an Enterprise project?",
  "subtitle": "Drop us a line — we usually reply within one business day.",
  "successTitle": "Message sent",
  "successText": "Thank you, we will get back to you shortly."
}$json$::jsonb),

('footer', 'en', $json${
  "tagline": "Direct-streaming video and playlist downloads, with no disk storage.",
  "copyright": "AZ Web Solutions. All rights reserved."
}$json$::jsonb),

('cookies', 'en', $json${
  "eyebrow": "Privacy",
  "title": "Cookie policy",
  "updatedAt": "12 September 2026",
  "intro": "This site uses only cookies that are strictly necessary for it to work. No advertising cookies, no third-party trackers, no analytics. We neither sell nor share any data.",
  "noticeText": "We only use cookies essential to running the service (signing in and counting the free quota). No advertising trackers.",
  "noticeDismiss": "Got it",
  "noticeMore": "Cookie policy",
  "consentNote": "Because these cookies are strictly necessary for the service you are requesting, your consent is not required — the rules do require that you be clearly informed, which is what this page does. If we ever added analytics or advertising, you would be given a genuine choice beforehand.",
  "categories": [
    {
      "name": "Strictly necessary cookies",
      "status": "Always on · no consent required",
      "description": "Without them, signing in to your account and enforcing the free quota are impossible.",
      "cookies": [
        { "name": "at", "purpose": "Authentication token. Identifies you during your session.", "duration": "15 minutes", "note": "Not readable by JavaScript (httpOnly)" },
        { "name": "rt", "purpose": "Renewal token. Saves you from signing in again on every visit.", "duration": "30 days", "note": "Not readable by JavaScript (httpOnly), limited to the authentication routes" },
        { "name": "has_session", "purpose": "A technical flag telling the interface that a session exists, so you are not wrongly shown as signed out.", "duration": "30 days", "note": "Contains only the value 1, no personal data" },
        { "name": "gsid", "purpose": "Identifies your browser in order to count the free video granted to visitors without an account.", "duration": "30 days", "note": "A random identifier, unconnected to your identity" }
      ]
    }
  ],
  "storage": {
    "title": "Local storage",
    "body": "Your browser remembers that you closed the information notice, so it is not shown again on every page. That stays on your device and is never sent to us."
  },
  "serverSide": {
    "title": "Data processed on the server",
    "body": "To apply the free download limit to visitors without an account, we combine your IP address and browser type into an encrypted fingerprint (HMAC-SHA256). That fingerprint is irreversible: we keep neither your IP address nor your browser in clear text, and it is used for quota counting only. Legal basis: legitimate interest in preventing abuse of the free tier."
  },
  "rights": {
    "title": "Your rights",
    "body": "You can delete these cookies at any time from your browser settings; you will then be signed out and the guest quota will start over. You have the right to access, rectify, erase and object to the processing of your data. To exercise it, get in touch.",
    "ctaLabel": "Contact us"
  }
}$json$::jsonb);

-- ---------------------------------------------------------------------
-- trigger: keep users.updated_at fresh
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_tier_quotas_touch BEFORE UPDATE ON tier_quotas
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_site_content_touch BEFORE UPDATE ON site_content
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_platforms_touch BEFORE UPDATE ON platforms
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
