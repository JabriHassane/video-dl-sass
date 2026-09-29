import { useEffect, useState } from 'react';
import { api } from '../api.js';

function TierQuotasTable({ tiers, usage, onSaved }) {
  const [drafts, setDrafts] = useState({});
  const [savingRole, setSavingRole] = useState(null);

  function fieldValue(tier, field) {
    return drafts[tier.role]?.[field] ?? tier[field];
  }

  function setField(role, field, value) {
    setDrafts((d) => ({ ...d, [role]: { ...d[role], [field]: value } }));
  }

  async function save(tier) {
    setSavingRole(tier.role);
    try {
      await api.adminUpdateTier(tier.role, {
        monthlyDownloadLimit: Number(fieldValue(tier, 'monthly_download_limit')),
        maxPlaylistItems: Number(fieldValue(tier, 'max_playlist_items')),
        allowHd: Boolean(fieldValue(tier, 'allow_hd')),
        maxResolution: fieldValue(tier, 'max_resolution'),
        maxConcurrentStreams: Number(fieldValue(tier, 'max_concurrent_streams')),
      });
      await onSaved();
    } finally {
      setSavingRole(null);
    }
  }

  const usageByRole = Object.fromEntries((usage ?? []).map((u) => [u.role, u]));

  return (
    <div className="table-scroll">
    <table className="admin-table">
      <thead>
        <tr>
          <th>Rôle</th>
          <th>Limite/mois (-1 = illimité)</th>
          <th>Items max par téléchargement<br /><span className="hint">0 = playlists interdites, -1 = illimité</span></th>
          <th>HD/4K</th>
          <th>Résolution max</th>
          <th>Flux concurrents</th>
          <th>Ce mois-ci</th>
          <th>24h</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {tiers.map((tier) => (
          <tr key={tier.role}>
            <td><strong>{tier.role}</strong></td>
            <td>
              <input
                type="number"
                value={fieldValue(tier, 'monthly_download_limit')}
                onChange={(e) => setField(tier.role, 'monthly_download_limit', e.target.value)}
              />
            </td>
            <td>
              <input
                type="number"
                value={fieldValue(tier, 'max_playlist_items')}
                onChange={(e) => setField(tier.role, 'max_playlist_items', e.target.value)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={Boolean(fieldValue(tier, 'allow_hd'))}
                onChange={(e) => setField(tier.role, 'allow_hd', e.target.checked)}
              />
            </td>
            <td>
              <select
                value={fieldValue(tier, 'max_resolution')}
                onChange={(e) => setField(tier.role, 'max_resolution', e.target.value)}
              >
                {['480p', '720p', '1080p', '4k'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </td>
            <td>
              <input
                type="number"
                value={fieldValue(tier, 'max_concurrent_streams')}
                onChange={(e) => setField(tier.role, 'max_concurrent_streams', e.target.value)}
              />
            </td>
            <td>{usageByRole[tier.role]?.downloads_this_month ?? 0}</td>
            <td>{usageByRole[tier.role]?.downloads_last_24h ?? 0}</td>
            <td>
              <button onClick={() => save(tier)} disabled={savingRole === tier.role}>
                {savingRole === tier.role ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function UserOverrides() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [formByUser, setFormByUser] = useState({});
  const [message, setMessage] = useState(null);

  async function loadUsers(q = '') {
    const rows = await api.adminUsers(q);
    setUsers(rows);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function setForm(userId, field, value) {
    setFormByUser((f) => ({ ...f, [userId]: { ...f[userId], [field]: value } }));
  }

  async function applyOverride(userId) {
    const form = formByUser[userId] ?? {};
    await api.adminSetOverride({
      userId,
      customMonthlyLimit: Number(form.customMonthlyLimit ?? -1),
      expiresAt: form.expiresAt || null,
      reason: form.reason || null,
    });
    setMessage(`Override appliqué pour ${userId}`);
    await loadUsers(search);
  }

  async function removeOverride(userId) {
    await api.adminDeleteOverride(userId);
    setMessage(`Override supprimé pour ${userId}`);
    await loadUsers(search);
  }

  return (
    <div>
      <h2>Overrides individuels</h2>
      <form
        className="inline-search"
        onSubmit={(e) => {
          e.preventDefault();
          loadUsers(search);
        }}
      >
        <input
          placeholder="Rechercher par email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit">Rechercher</button>
      </form>
      {message && <p className="hint">{message}</p>}

      <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Rôle</th>
            <th>Override actif</th>
            <th>Nouvelle limite (-1 = illimité)</th>
            <th>Expiration (optionnel)</th>
            <th>Raison</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                {u.override_limit != null
                  ? `${u.override_limit} (exp: ${u.override_expires_at ? new Date(u.override_expires_at).toLocaleDateString() : 'jamais'})`
                  : '—'}
              </td>
              <td>
                <input
                  type="number"
                  placeholder="-1"
                  onChange={(e) => setForm(u.id, 'customMonthlyLimit', e.target.value)}
                />
              </td>
              <td>
                <input type="date" onChange={(e) => setForm(u.id, 'expiresAt', e.target.value)} />
              </td>
              <td>
                <input type="text" placeholder="Promo, support..." onChange={(e) => setForm(u.id, 'reason', e.target.value)} />
              </td>
              <td className="row-actions">
                <button onClick={() => applyOverride(u.id)}>Appliquer</button>
                {u.override_limit != null && (
                  <button className="danger" onClick={() => removeOverride(u.id)}>Retirer</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function PlatformManager() {
  const [platforms, setPlatforms] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [creating, setCreating] = useState({ slug: '', name: '', domains: '', notes: '' });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      setPlatforms(await api.adminPlatforms());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function domainsValue(p) {
    return drafts[p.id]?.domains ?? p.domains.join(', ');
  }

  async function save(p) {
    setBusy(p.id);
    setError(null);
    try {
      await api.adminUpdatePlatform(p.id, {
        domains: domainsValue(p).split(',').map((d) => d.trim()).filter(Boolean),
        notes: drafts[p.id]?.notes ?? p.notes ?? '',
      });
      setDrafts((d) => ({ ...d, [p.id]: undefined }));
      setMessage(`"${p.name}" enregistrée.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(p) {
    setBusy(p.id);
    try {
      await api.adminUpdatePlatform(p.id, { enabled: !p.enabled });
      setMessage(`"${p.name}" ${p.enabled ? 'désactivée' : 'activée'}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleAuth(p) {
    setBusy(p.id);
    try {
      await api.adminUpdatePlatform(p.id, { requiresAuth: !p.requires_auth });
      setMessage(
        `"${p.name}" marquée comme ${p.requires_auth ? 'accessible anonymement' : 'nécessitant une session'}.`,
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(p) {
    setBusy(p.id);
    try {
      await api.adminDeletePlatform(p.id);
      setMessage(`"${p.name}" supprimée.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy('new');
    setError(null);
    try {
      await api.adminCreatePlatform({
        slug: creating.slug.trim(),
        name: creating.name.trim(),
        domains: creating.domains.split(',').map((d) => d.trim()).filter(Boolean),
        notes: creating.notes.trim() || undefined,
      });
      setCreating({ slug: '', name: '', domains: '', notes: '' });
      setMessage('Plateforme ajoutée.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !platforms) return <p className="error">{error}</p>;
  if (!platforms) return <p className="hint">Chargement des plateformes...</p>;

  return (
    <div>
      <h2>Plateformes autorisées</h2>
      <p className="hint">
        Cette liste <strong>est</strong> le filtre de sécurité : seuls les domaines listés ici et
        activés peuvent être téléchargés, tout le reste est rejeté avant extraction. Désactiver une
        plateforme coupe immédiatement les téléchargements correspondants, sans redéploiement.
      </p>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Plateforme</th>
            <th>Domaines (séparés par des virgules)</th>
            <th>Note</th>
            <th>Active</th>
            <th>Session requise<br /><span className="hint">refuse l'anonyme</span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong><br /><span className="hint">{p.slug}</span></td>
              <td>
                <input
                  value={domainsValue(p)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], domains: e.target.value } }))}
                />
              </td>
              <td>
                <input
                  value={drafts[p.id]?.notes ?? p.notes ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], notes: e.target.value } }))}
                />
              </td>
              <td style={{ textAlign: 'center' }}>
                <input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} disabled={busy === p.id} />
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={p.requires_auth}
                  onChange={() => toggleAuth(p)}
                  disabled={busy === p.id}
                />
              </td>
              <td className="row-actions">
                <button onClick={() => save(p)} disabled={busy === p.id}>Enregistrer</button>
                <button className="danger" onClick={() => remove(p)} disabled={busy === p.id}>Supprimer</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h3 style={{ marginTop: 24 }}>Ajouter une plateforme</h3>
      <form onSubmit={create} className="inline-search" style={{ flexWrap: 'wrap' }}>
        <input
          placeholder="slug (ex: kick)"
          value={creating.slug}
          onChange={(e) => setCreating((c) => ({ ...c, slug: e.target.value }))}
          required
        />
        <input
          placeholder="Nom affiché"
          value={creating.name}
          onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
          required
        />
        <input
          placeholder="domaines: kick.com, www.kick.com"
          value={creating.domains}
          onChange={(e) => setCreating((c) => ({ ...c, domains: e.target.value }))}
          required
          style={{ minWidth: 240 }}
        />
        <input
          placeholder="note (optionnel)"
          value={creating.notes}
          onChange={(e) => setCreating((c) => ({ ...c, notes: e.target.value }))}
        />
        <button type="submit" disabled={busy === 'new'}>Ajouter</button>
      </form>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function ActivityChart({ byDay }) {
  // Always render a fixed 14-day window, zero-filling days with no rows —
  // otherwise a quiet week would draw a shorter, misleadingly-scaled chart
  // instead of visibly flat bars.
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const countByDay = Object.fromEntries((byDay ?? []).map((r) => [r.day.slice(0, 10), Number(r.count)]));
  const max = Math.max(1, ...days.map((d) => countByDay[d] ?? 0));

  return (
    <div className="bar-chart">
      {days.map((d) => (
        <div key={d} className="bar-chart-col" title={`${d} : ${countByDay[d] ?? 0}`}>
          <div className="bar-chart-bar" style={{ height: `${((countByDay[d] ?? 0) / max) * 100}%` }} />
          <span className="bar-chart-label">{d.slice(8, 10)}</span>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.adminStats().then(setStats).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="hint">Chargement du tableau de bord...</p>;

  const t = stats.totals;
  const maxRoleCount = Math.max(1, ...stats.usersByRole.map((r) => Number(r.count)));
  const maxSourceCount = Math.max(1, ...stats.topSources.map((s) => Number(s.count)));

  return (
    <div>
      <h2>Tableau de bord</h2>
      <div className="stat-cards">
        <StatCard label="Utilisateurs" value={t.total_users} />
        <StatCard label="Nouveaux (30j)" value={t.new_users_30d} />
        <StatCard label="Téléchargements ce mois" value={t.downloads_this_month} />
        <StatCard label="Téléchargements (24h)" value={t.downloads_24h} />
        <StatCard label="Total historique" value={t.downloads_all_time} />
        <StatCard label="Échecs (24h)" value={t.failed_24h} />
      </div>

      <h3 style={{ marginTop: 28 }}>Activité — 14 derniers jours</h3>
      <ActivityChart byDay={stats.byDay} />

      <div className="dashboard-columns">
        <div>
          <h3>Utilisateurs par rôle</h3>
          <div className="hbar-list">
            {stats.usersByRole.map((r) => (
              <div key={r.role} className="hbar-row">
                <span className="hbar-label">{r.role}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(Number(r.count) / maxRoleCount) * 100}%` }} />
                </div>
                <span className="hbar-value">{r.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3>Sources les plus téléchargées (30j)</h3>
          <div className="hbar-list">
            {stats.topSources.length === 0 && <p className="hint">Aucune donnée pour le moment.</p>}
            {stats.topSources.map((s) => (
              <div key={s.host} className="hbar-row">
                <span className="hbar-label">{s.host}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(Number(s.count) / maxSourceCount) * 100}%` }} />
                </div>
                <span className="hbar-value">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Dernières inscriptions</h3>
      <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Rôle</th>
            <th>Inscrit le</th>
          </tr>
        </thead>
        <tbody>
          {stats.recentUsers.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{new Date(u.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const SITE_CONTENT_SECTIONS = [
  { key: 'landing', label: 'Landing' },
  { key: 'pricing', label: 'Tarifs (textes)' },
  { key: 'about', label: 'À propos' },
  { key: 'faq', label: 'FAQ' },
  { key: 'contact', label: 'Contact' },
  { key: 'footer', label: 'Footer' },
  { key: 'cookies', label: 'Politique de cookies' },
];

const LANG_LABELS = { fr: 'Français', en: 'English' };

function SiteContentEditor() {
  const [payload, setPayload] = useState(null);
  const [lang, setLang] = useState('fr');
  // Drafts are keyed by "lang:section" so switching language mid-edit
  // never shows one language's unsaved text under another's tab.
  const [drafts, setDrafts] = useState({});
  const [jsonErrors, setJsonErrors] = useState({});
  const [savingSection, setSavingSection] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const data = await api.adminSiteContent();
      setPayload(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const languages = payload?.languages ?? ['fr'];
  const defaultLang = payload?.defaultLang ?? 'fr';
  const rows = payload?.content?.[lang] ?? {};

  const draftKey = (section) => `${lang}:${section}`;

  function textFor(section) {
    const k = draftKey(section);
    if (drafts[k] !== undefined) return drafts[k];

    const row = rows[section];
    // No row means this section has never been translated into this
    // language. Pre-fill from the default language rather than showing
    // "{}" — translating is editing existing copy, not writing the JSON
    // structure from memory.
    const fallback = payload?.content?.[defaultLang]?.[section];
    return JSON.stringify(row?.data ?? fallback?.data ?? {}, null, 2);
  }

  function setDraft(section, text) {
    const k = draftKey(section);
    setDrafts((d) => ({ ...d, [k]: text }));
    try {
      JSON.parse(text);
      setJsonErrors((e) => ({ ...e, [k]: null }));
    } catch (err) {
      setJsonErrors((e) => ({ ...e, [k]: 'JSON invalide : ' + err.message }));
    }
  }

  async function save(section) {
    const k = draftKey(section);
    let parsed;
    try {
      parsed = JSON.parse(textFor(section));
    } catch (err) {
      setJsonErrors((e) => ({ ...e, [k]: 'JSON invalide : ' + err.message }));
      return;
    }
    setSavingSection(k);
    setMessage(null);
    try {
      await api.adminUpdateSiteContent(section, lang, parsed);
      setMessage(
        `Section "${section}" (${LANG_LABELS[lang] ?? lang}) enregistrée — visible immédiatement sur le site.`,
      );
      setDrafts((d) => ({ ...d, [k]: undefined }));
      await load();
    } catch (err) {
      setMessage(null);
      setJsonErrors((e) => ({ ...e, [k]: err.message }));
    } finally {
      setSavingSection(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!payload) return <p className="hint">Chargement du contenu...</p>;

  return (
    <div>
      <h2>Contenu du site</h2>
      <p className="hint">
        Chaque section ci-dessous contrôle exactement les textes affichés sur la page publique
        correspondante (landing, tarifs, à propos, FAQ, contact, footer, cookies). Modifiez le JSON
        puis enregistrez — le changement est visible immédiatement, sans redéploiement. Une section
        non traduite affiche automatiquement la version {LANG_LABELS[defaultLang] ?? defaultLang} sur
        le site public.
      </p>

      <div className="lang-tabs" role="tablist" aria-label="Langue du contenu">
        {languages.map((code) => (
          <button
            key={code}
            role="tab"
            aria-selected={code === lang}
            className={`lang-tab ${code === lang ? 'active' : ''}`}
            onClick={() => setLang(code)}
          >
            {LANG_LABELS[code] ?? code}
            {code === defaultLang && <span className="lang-tab-note">par défaut</span>}
          </button>
        ))}
      </div>

      {message && <p className="hint">{message}</p>}

      {SITE_CONTENT_SECTIONS.map(({ key, label }) => {
        const k = draftKey(key);
        const row = rows[key];
        return (
          <div key={k} className="content-editor-block">
            <div className="content-editor-header">
              <h3>{label}</h3>
              {row?.updated_at ? (
                <span className="hint">
                  Dernière modification : {new Date(row.updated_at).toLocaleString()}
                </span>
              ) : (
                <span className="hint warn">
                  Pas encore traduit — pré-rempli depuis « {LANG_LABELS[defaultLang]} »
                </span>
              )}
            </div>
            <textarea
              className="json-editor"
              rows={10}
              spellCheck={false}
              value={textFor(key)}
              onChange={(e) => setDraft(key, e.target.value)}
            />
            {jsonErrors[k] && <p className="error">{jsonErrors[k]}</p>}
            <button onClick={() => save(key)} disabled={savingSection === k || Boolean(jsonErrors[k])}>
              {savingSection === k ? 'Enregistrement...' : `Enregistrer "${label}"`}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ContactMessages() {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.adminContactMessages().then(setMessages).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!messages) return <p className="hint">Chargement...</p>;

  return (
    <div>
      <h2>Messages de contact ({messages.length})</h2>
      {messages.length === 0 ? (
        <p className="hint">Aucun message pour le moment.</p>
      ) : (
        <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Nom</th>
              <th>Email</th>
              <th>Sujet</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.created_at).toLocaleString()}</td>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>{m.subject || '—'}</td>
                <td>{m.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  { key: 'dashboard', label: 'Tableau de bord', icon: 'fa-solid fa-chart-line' },
  { key: 'quotas', label: 'Quotas par rôle', icon: 'fa-solid fa-sliders' },
  { key: 'users', label: 'Utilisateurs', icon: 'fa-solid fa-users' },
  { key: 'platforms', label: 'Plateformes', icon: 'fa-solid fa-globe' },
  { key: 'content', label: 'Contenu du site', icon: 'fa-solid fa-file-lines' },
  { key: 'messages', label: 'Messages', icon: 'fa-solid fa-envelope' },
];

function QuotasSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setData(await api.adminQuotas());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="hint">Chargement...</p>;

  return (
    <div>
      <h2>Quotas par rôle</h2>
      <TierQuotasTable tiers={data.tiers} usage={data.usage} onSaved={load} />
    </div>
  );
}

export default function Admin() {
  const [section, setSection] = useState('dashboard');

  const content = {
    dashboard: <Dashboard />,
    quotas: <QuotasSection />,
    users: <UserOverrides />,
    platforms: <PlatformManager />,
    content: <SiteContentEditor />,
    messages: <ContactMessages />,
  }[section];

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h1>Administration</h1>
        <nav>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`admin-sidebar-link ${section === s.key ? 'active' : ''}`}
              onClick={() => setSection(s.key)}
            >
              <i className={`${s.icon} admin-sidebar-icon`} aria-hidden="true" /> {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="card admin-page admin-content">{content}</div>
    </div>
  );
}
