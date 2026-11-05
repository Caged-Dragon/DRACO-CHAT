import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/image.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { THEME_TABS, DEFAULT_THEME } from '../theme/fields.js';
import AppPreviewMock from './AppPreviewMock.jsx';

const DISAPPEAR_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '24 hours', value: 24 * 3600 },
  { label: '7 days', value: 7 * 24 * 3600 },
];

// theme/wallpaperUrl here are only the OVERRIDES for this one chat —
// an empty/unset field means "use the global theme's color instead".
export default function ChatThemeModal({
  friend,
  theme,
  wallpaperUrl,
  disappearingSeconds,
  onDisappearingChange,
  onChange,
  onClose,
}) {
  const { user } = useAuth();
  const { theme: globalTheme, wallpaperUrl: globalWallpaper } = useTheme();
  const [activeTab, setActiveTab] = useState(THEME_TABS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const currentTab = THEME_TABS.find((t) => t.id === activeTab);
  // What the preview should actually show: this chat's override if
  // set, else the global theme's color, else the hard default.
  const resolved = { ...DEFAULT_THEME, ...globalTheme, ...theme };
  const resolvedWallpaper = wallpaperUrl || globalWallpaper || null;

  async function saveTheme(nextTheme, nextWallpaperUrl) {
    const { error } = await supabase.from('chat_settings').upsert(
      {
        owner_id: user.id,
        friend_id: friend.id,
        theme: nextTheme,
        wallpaper_url: nextWallpaperUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,friend_id' }
    );
    if (error) {
      setError(error.message);
      return;
    }
    onChange(nextTheme, nextWallpaperUrl);
  }

  function handleColorChange(key, value) {
    saveTheme({ ...theme, [key]: value }, wallpaperUrl);
  }

  function handleClearColor(key) {
    const next = { ...theme };
    delete next[key];
    saveTheme(next, wallpaperUrl);
  }

  async function handleWallpaperPick(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    setError('');

    const file = await compressImage(picked, { maxDim: 1920, quality: 0.8 });
    const path = `${user.id}/chat-${friend.id}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-wallpapers')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { data: pub } = supabase.storage.from('chat-wallpapers').getPublicUrl(path);
    await saveTheme(theme, pub.publicUrl);
    setBusy(false);
  }

  async function handleResetAll() {
    setBusy(true);
    await saveTheme({}, null);
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Chat settings — {friend.username}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="dim small">
          Only changes how this one conversation looks for you. Untouched
          colors keep using your global theme.
        </p>

        <AppPreviewMock values={resolved} wallpaperUrl={resolvedWallpaper} />

        <div className="theme-tabs">
          {THEME_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="theme-tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className={`theme-tab ${activeTab === 'wallpaper' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallpaper')}
          >
            <span className="theme-tab-icon">🖼️</span>
            Wallpaper
          </button>
          <button
            type="button"
            className={`theme-tab ${activeTab === 'disappearing' ? 'active' : ''}`}
            onClick={() => setActiveTab('disappearing')}
          >
            <span className="theme-tab-icon">⏱</span>
            Disappearing
          </button>
        </div>

        <div className="theme-tab-panel">
          {activeTab === 'disappearing' ? (
            <div className="field-list">
              <label className="field-row">
                <span>Disappearing messages</span>
                <select
                  value={disappearingSeconds}
                  onChange={(e) => onDisappearingChange(Number(e.target.value))}
                >
                  {DISAPPEAR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="dim small">New messages you send will auto-hide after this long.</p>
            </div>
          ) : activeTab === 'wallpaper' ? (
            <div className="field-list">
              <div className="wallpaper-actions">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  {busy ? 'Uploading...' : wallpaperUrl ? 'Change image' : 'Upload image'}
                </button>
                {wallpaperUrl && (
                  <button type="button" className="ghost-btn" onClick={() => saveTheme(theme, null)}>
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleWallpaperPick}
                hidden
              />
            </div>
          ) : (
            <div className="field-list">
              {currentTab.fields.map((f) => (
                <label className="field-row" key={f.key}>
                  <span>{f.label}</span>
                  <div className="field-row-controls">
                    <input
                      type="color"
                      value={resolved[f.key]}
                      onChange={(e) => handleColorChange(f.key, e.target.value)}
                    />
                    {theme[f.key] && (
                      <button
                        type="button"
                        className="clear-color-btn"
                        onClick={() => handleClearColor(f.key)}
                        aria-label={`Reset ${f.label} to global`}
                        title="Reset to global theme"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-footer">
          <button type="button" className="ghost-btn" onClick={handleResetAll} disabled={busy}>
            Reset this chat
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
