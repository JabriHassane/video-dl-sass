import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { api } from '../api.js';

function mediaTypeLabel(type) {
  return { VIDEO: 'Vidéo', PLAYLIST_ZIP: 'Playlist (zip)', AUDIO: 'Audio' }[type] ?? type;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ProfileForm({ user, onSaved }) {
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProfile(email);
      setMessage('Adresse email mise à jour.');
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="account-form">
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={saving || email === user.email}>
        {saving ? 'Enregistrement...' : 'Mettre à jour'}
      </button>
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage('Mot de passe changé.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="account-form">
      <label>
        Mot de passe actuel
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </label>
      <label>
        Nouveau mot de passe
        <input
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
      </label>
      <label>
        Confirmer le nouveau mot de passe
        <input type="password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? 'Enregistrement...' : 'Changer le mot de passe'}
      </button>
    </form>
  );
}

function DownloadHistory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.accountDownloads(20).then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="hint">Chargement...</p>;

  return (
    <div>
      <p className="hint">{data.totalCount} téléchargement(s) au total.</p>
      {data.items.length === 0 ? (
        <p className="hint">Aucun téléchargement pour le moment.</p>
      ) : (
        <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Résolution</th>
              <th>Taille</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.created_at).toLocaleString()}</td>
                <td>{mediaTypeLabel(item.media_type)}</td>
                <td>{item.resolution ?? '—'}</td>
                <td>{formatBytes(Number(item.bytes_transferred))}</td>
                <td>{item.completed ? '✓ Terminé' : '✗ Interrompu'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

export default function Account() {
  const { user, quota, refresh } = useAuth();
  if (!user) return null;

  const unlimited = quota?.limit === -1;

  return (
    <div className="card admin-page">
      <h1>Mon compte</h1>

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-label">Rôle</span>
          <span className="stat-value">{quota?.role ?? user.role}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Téléchargements ce mois-ci</span>
          <span className="stat-value">{unlimited ? '∞' : `${quota?.used ?? 0} / ${quota?.limit ?? '—'}`}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Qualité max</span>
          <span className="stat-value">{quota?.allowHd ? (quota?.maxResolution ?? '4k') : '480p'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Playlists</span>
          <span className="stat-value">
            {quota?.maxPlaylistItems === 0 ? 'Non' : quota?.maxPlaylistItems === -1 ? 'Illimité' : `Jusqu'à ${quota?.maxPlaylistItems}`}
          </span>
        </div>
      </div>

      {!unlimited && quota?.limit > 0 && (
        <div className="quota-bar">
          <div
            className="quota-bar-fill"
            style={{ width: `${Math.min(100, ((quota.used ?? 0) / quota.limit) * 100)}%` }}
          />
        </div>
      )}

      <h2>Informations du compte</h2>
      <ProfileForm user={user} onSaved={refresh} />

      <h2>Mot de passe</h2>
      <PasswordForm />

      <h2>Historique des téléchargements</h2>
      <DownloadHistory />
    </div>
  );
}
