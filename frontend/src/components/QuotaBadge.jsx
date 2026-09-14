import { useAuth } from '../AuthContext.jsx';
import { useT } from '../LanguageContext.jsx';

export default function QuotaBadge() {
  const { quota, loading } = useAuth();
  const t = useT();
  if (loading || !quota) return null;

  const unlimited = quota.limit === -1;

  return (
    <div className="quota-badge">
      <strong>{quota.role}</strong>
      <span>
        {unlimited
          ? t('quota.unlimited')
          : t('quota.usedThisMonth', { used: quota.used ?? 0, limit: quota.limit })}
      </span>
      <span>{quota.allowHd ? t('quota.hdUnlocked') : t('quota.limitedTo480')}</span>
      <span>
        {quota.maxPlaylistItems === 0
          ? t('quota.noPlaylists')
          : quota.maxPlaylistItems === -1
            ? t('quota.unlimitedPlaylists')
            : t('quota.playlistsUpTo', { n: quota.maxPlaylistItems })}
      </span>
    </div>
  );
}
