import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/image.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import { PRESENCE_LABELS } from '../utils/format.js';
import { usePushNotifications } from '../hooks/usePushNotifications.js';

const STATUS_OPTIONS = ['online', 'away', 'busy', 'dnd'];
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export default function ProfileModal({ onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const push = usePushNotifications();
  const [username, setUsername] = useState(profile?.username || '');
  const [statusMessage, setStatusMessage] = useState(profile?.status_message || '');
  const [presenceStatus, setPresenceStatus] = useState(profile?.presence_status || 'online');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef(null);

  const dragonId = profile?.user_number
    ? `#${String(profile.user_number).padStart(6, '0')}`
    : null;

  async function handleAvatarPick(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    setError('');

    const file = await compressImage(picked, { maxDim: 512, quality: 0.85 });
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
      upsert: true,
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: pub.publicUrl })
      .eq('id', user.id);

    if (updateError) setError(updateError.message);
    else await refreshProfile();
    setBusy(false);
  }

  async function handleSave() {
    setError('');

    const trimmedUsername = username.trim();
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setError('Username must be 3-20 characters: letters, numbers, or underscores only.');
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        username: trimmedUsername,
        status_message: statusMessage.trim() || null,
        presence_status: presenceStatus,
      })
      .eq('id', user.id);

    if (error) {
      // Postgres unique_violation — someone already has this username
      if (error.code === '23505') {
        setError('That username is already taken — try another.');
      } else {
        setError(error.message);
      }
    } else {
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Your profile</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="profile-avatar-row">
          <Avatar url={profile?.avatar_url} name={profile?.username} size={72} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading...' : 'Change photo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarPick}
            hidden
          />
        </div>

        {dragonId && (
          <p className="dragon-id-row">
            Your Dragon Chat ID: <span className="dragon-id-value">{dragonId}</span>
          </p>
        )}

        <div className="field-list">
          <label className="field-row field-row-stacked">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
            />
          </label>

          <label className="field-row field-row-stacked">
            <span>Status message</span>
            <input
              type="text"
              placeholder="What's on your mind?"
              value={statusMessage}
              onChange={(e) => setStatusMessage(e.target.value)}
              maxLength={80}
            />
          </label>

          <label className="field-row field-row-stacked">
            <span>Status</span>
            <select value={presenceStatus} onChange={(e) => setPresenceStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {PRESENCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="push-toggle-row">
          <div>
            <span className="push-toggle-label">🔔 Push notifications</span>
            <p className="dim small">Get notified of new messages even when the app is closed.</p>
          </div>
          {push.supported ? (
            <button
              type="button"
              className={push.subscribed ? 'ghost-btn' : ''}
              onClick={push.subscribed ? push.disable : push.enable}
              disabled={push.busy}
            >
              {push.busy ? '...' : push.subscribed ? 'Disable' : 'Enable'}
            </button>
          ) : (
            <span className="dim small">Not supported on this browser</span>
          )}
        </div>
        {push.error && <p className="error-text small">{push.error}</p>}

        {error && <p className="error-text">{error}</p>}
        {saved && <p className="info-text">Saved!</p>}

        <div className="modal-footer">
          <span />
          <button type="button" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
