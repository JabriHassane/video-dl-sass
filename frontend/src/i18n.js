/**
 * UI chrome strings — buttons, labels, table headers, status messages.
 *
 * Marketing copy is NOT here: it lives in the `site_content` table so an
 * admin can edit it per language without a redeploy. This file holds only
 * the strings that are part of the interface itself and would be
 * meaningless to hand to a non-technical editor ("Analyser le lien",
 * column headers, form validation). The split is deliberate: content the
 * business owns goes in the database, wording the product owns ships with
 * the code.
 */

export const LANGUAGES = [
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'en', label: 'English', short: 'EN' },
];

export const DEFAULT_LANG = 'fr';

const STRINGS = {
  fr: {
    // --- Navigation -----------------------------------------------
    'nav.pricing': 'Tarifs',
    'nav.about': 'À propos',
    'nav.faq': 'FAQ',
    'nav.contact': 'Contact',
    'nav.openApp': "Ouvrir l'app",
    'nav.admin': 'Admin',
    'nav.login': 'Connexion',
    'nav.register': 'Créer un compte',
    'nav.logout': 'Déconnexion',
    'nav.language': 'Langue',

    // --- Footer ---------------------------------------------------
    'footer.product': 'Produit',
    'footer.company': 'Entreprise',
    'footer.apiDocs': 'API Docs',
    'footer.cookiePolicy': 'Politique de cookies',

    // --- Landing demo mock (decorative, but still user-visible) ------
    'landing.demoStatus': 'Streaming direct — 0 octet écrit sur disque',

    // --- Download app ---------------------------------------------
    'dl.title': "Télécharger depuis n'importe quel lien",
    'dl.label': 'Collez un lien (vidéo, reel, short ou playlist)',
    'dl.analyze': 'Analyser le lien',
    'dl.analyzing': 'Analyse du lien',
    'dl.authHint':
      "Cette plateforme refuse les requêtes anonymes. Un administrateur doit configurer une session (fichier de cookies) sur le serveur pour l'activer — voir",
    'dl.video': 'Vidéo',
    'dl.playlistCount': 'Playlist · {n} vidéos',
    'dl.untitled': 'Sans titre',
    'dl.quality': 'Qualité',
    'dl.selected': '{n} sélectionnée',
    'dl.selectedPlural': '{n} sélectionnées',
    'dl.maxForPlan': ' / {n} max pour votre offre',
    'dl.truncated': 'Liste tronquée',
    'dl.downloadVideo': 'Télécharger la vidéo',
    'dl.downloadZip': 'Télécharger la sélection ({n}) en .zip',
    'dl.supported': 'Plateformes supportées',
    'dl.needsSession': 'nécessite une session configurée côté serveur',
    'dl.sessionRequired': 'session requise',

    // --- Quota badge ----------------------------------------------
    'quota.unlimited': 'Téléchargements illimités',
    'quota.usedThisMonth': '{used} / {limit} ce mois-ci',
    'quota.hdUnlocked': 'HD/4K débloqué',
    'quota.limitedTo480': 'Limité à 480p',
    'quota.noPlaylists': 'Playlists indisponibles',
    'quota.unlimitedPlaylists': 'Playlists illimitées',
    'quota.playlistsUpTo': "Playlists jusqu'à {n} vidéos",

    // --- Auth -----------------------------------------------------
    'auth.login': 'Connexion',
    'auth.register': 'Créer un compte',
    'auth.email': 'Email',
    'auth.password': 'Mot de passe',
    'auth.passwordMin': 'Mot de passe (8 caractères min.)',
    'auth.signIn': 'Se connecter',
    'auth.signingIn': 'Connexion...',
    'auth.creating': 'Création...',
    'auth.createAccount': 'Créer le compte',
    'auth.noAccount': 'Pas de compte ?',
    'auth.createOne': 'En créer un',
    'auth.haveAccount': 'Déjà inscrit ?',

    // --- Pricing --------------------------------------------------
    'price.unlimited': 'Illimité',
    'price.perMonth': '{n}/mois',
    'price.recommended': 'Recommandé',
    'price.upTo': "Résolution jusqu'à {res}",
    'price.feature': 'Fonctionnalité',
    'price.downloadsPerMonth': 'Téléchargements / mois',
    'price.maxResolution': 'Résolution max',
    'price.playlists': 'Playlists (ZIP)',
    'price.concurrent': 'Flux simultanés',
    'price.apiAccess': 'Accès API + Swagger',
    'price.support': 'Support',
    'price.supportCommunity': 'Communautaire',
    'price.supportPriority': 'Prioritaire',
    'price.supportDedicated': 'Dédié + SLA',
    'price.custom': 'Sur mesure',
    'price.unavailable': 'Indisponible',
    'price.maxVideos': '{n} vidéos max',
    'price.playlistsLabel': 'Playlists :',
    'price.stream': '{n} flux simultané',
    'price.streams': '{n} flux simultanés',
    'price.apiPriority': '✓ (prioritaire)',

    // --- Cookies page ---------------------------------------------
    'cookies.updatedAt': 'Dernière mise à jour :',
    'cookies.colName': 'Nom',
    'cookies.colPurpose': 'Finalité',
    'cookies.colDuration': 'Durée',

    // --- Generic --------------------------------------------------
    'common.loading': 'Chargement...',
    'common.yes': 'Oui',
    'common.no': 'Non',
  },

  en: {
    'nav.pricing': 'Pricing',
    'nav.about': 'About',
    'nav.faq': 'FAQ',
    'nav.contact': 'Contact',
    'nav.openApp': 'Open the app',
    'nav.admin': 'Admin',
    'nav.login': 'Sign in',
    'nav.register': 'Create account',
    'nav.logout': 'Sign out',
    'nav.language': 'Language',

    'footer.product': 'Product',
    'footer.company': 'Company',
    'footer.apiDocs': 'API Docs',
    'footer.cookiePolicy': 'Cookie policy',

    'landing.demoStatus': 'Direct streaming — 0 bytes written to disk',

    'dl.title': 'Download from any link',
    'dl.label': 'Paste a link (video, reel, short or playlist)',
    'dl.analyze': 'Analyse the link',
    'dl.analyzing': 'Analysing the link',
    'dl.authHint':
      'This platform refuses anonymous requests. An administrator must configure a session (cookies file) on the server to enable it — see',
    'dl.video': 'Video',
    'dl.playlistCount': 'Playlist · {n} videos',
    'dl.untitled': 'Untitled',
    'dl.quality': 'Quality',
    'dl.selected': '{n} selected',
    'dl.selectedPlural': '{n} selected',
    'dl.maxForPlan': ' / {n} max on your plan',
    'dl.truncated': 'List truncated',
    'dl.downloadVideo': 'Download the video',
    'dl.downloadZip': 'Download selection ({n}) as .zip',
    'dl.supported': 'Supported platforms',
    'dl.needsSession': 'requires a session configured on the server',
    'dl.sessionRequired': 'session required',

    'quota.unlimited': 'Unlimited downloads',
    'quota.usedThisMonth': '{used} / {limit} this month',
    'quota.hdUnlocked': 'HD/4K unlocked',
    'quota.limitedTo480': 'Limited to 480p',
    'quota.noPlaylists': 'Playlists unavailable',
    'quota.unlimitedPlaylists': 'Unlimited playlists',
    'quota.playlistsUpTo': 'Playlists up to {n} videos',

    'auth.login': 'Sign in',
    'auth.register': 'Create an account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.passwordMin': 'Password (8 characters min.)',
    'auth.signIn': 'Sign in',
    'auth.signingIn': 'Signing in...',
    'auth.creating': 'Creating...',
    'auth.createAccount': 'Create account',
    'auth.noAccount': 'No account yet?',
    'auth.createOne': 'Create one',
    'auth.haveAccount': 'Already registered?',

    'price.unlimited': 'Unlimited',
    'price.perMonth': '{n}/month',
    'price.recommended': 'Recommended',
    'price.upTo': 'Resolution up to {res}',
    'price.feature': 'Feature',
    'price.downloadsPerMonth': 'Downloads / month',
    'price.maxResolution': 'Max resolution',
    'price.playlists': 'Playlists (ZIP)',
    'price.concurrent': 'Concurrent streams',
    'price.apiAccess': 'API access + Swagger',
    'price.support': 'Support',
    'price.supportCommunity': 'Community',
    'price.supportPriority': 'Priority',
    'price.supportDedicated': 'Dedicated + SLA',
    'price.custom': 'Custom',
    'price.unavailable': 'Unavailable',
    'price.maxVideos': '{n} videos max',
    'price.playlistsLabel': 'Playlists:',
    'price.stream': '{n} concurrent stream',
    'price.streams': '{n} concurrent streams',
    'price.apiPriority': '✓ (priority)',

    'cookies.updatedAt': 'Last updated:',
    'cookies.colName': 'Name',
    'cookies.colPurpose': 'Purpose',
    'cookies.colDuration': 'Duration',

    'common.loading': 'Loading...',
    'common.yes': 'Yes',
    'common.no': 'No',
  },
};

/**
 * Looks up a key, interpolating {placeholders}. An unknown key falls back
 * to the default language and then to the key itself — a missing English
 * string shows French, never a blank button.
 */
export function translate(lang, key, vars) {
  const value = STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

export function isSupported(code) {
  return LANGUAGES.some((l) => l.code === code);
}
