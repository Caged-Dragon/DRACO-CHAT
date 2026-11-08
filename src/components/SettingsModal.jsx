import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import AccountSecurity from './AccountSecurity.jsx';
import AdminReportsModal from './AdminReportsModal.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { THEME_TABS } from '../theme/fields.js';
import AppPreviewMock from './AppPreviewMock.jsx';

export default function SettingsModal({ onClose }) {
  const { theme, defaults, mode, setMode, wallpaperUrl, updateTheme, uploadWallpaper, clearWallpaper, resetTheme } =
    useTheme();
  const [activeTab, setActiveTab] = useState(THEME_TABS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const { signOut } = useAuth();
  const [showDelete, setShowDelete] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const currentTab = THEME_TABS.find((t) => t.id === activeTab);

  function handleColorChange(key, value) {
    updateTheme({ [key]: value });
  }

  async function handleWallpaperPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    const { error } = await uploadWallpaper(file);
    if (error) setError(error.message);
    setBusy(false);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError('');
    const { data, error } = await supabase.functions.invoke('chat-delete-account', {
      body: { confirm: 'DELETE' },
    });
    if (error || data?.error) {
      setDeleteError(data?.error || error?.message || 'Could not delete your chat account.');
      setDeleting(false);
      return;
    }
    await signOut();
  }

  async function handleReset() {
    setBusy(true);
    await resetTheme();
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>App theme</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="preset-row" role="group" aria-label="Appearance">
          <span className="dim small">Appearance:</span>
          <button type="button" className={`preset-btn ${mode === 'dark' ? 'active' : ''}`} aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>
            🌙 Dark
          </button>
          <button type="button" className={`preset-btn ${mode === 'light' ? 'active' : ''}`} aria-pressed={mode === 'light'} onClick={() => setMode('light')}>
            ☀️ Light
          </button>
        </div>

        <AppPreviewMock values={{ ...defaults, ...theme }} wallpaperUrl={wallpaperUrl} />

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
        </div>

        <div className="theme-tab-panel">
          {activeTab === 'wallpaper' ? (
            <div className="field-list">
              <div className="wallpaper-actions">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  {busy ? 'Uploading...' : wallpaperUrl ? 'Change image' : 'Upload image'}
                </button>
                {wallpaperUrl && (
                  <button type="button" className="ghost-btn" onClick={clearWallpaper}>
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
                  <input
                    type="color"
                    value={theme[f.key] || defaults[f.key]}
                    onChange={(e) => handleColorChange(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <AccountSecurity onOpenAdmin={() => setShowAdmin(true)} />
        {showAdmin && <AdminReportsModal onClose={() => setShowAdmin(false)} />}

        <div className="danger-zone">
          {!showDelete ? (
            <button type="button" className="danger-link" onClick={() => setShowDelete(true)}>
              Delete my chat account…
            </button>
          ) : (
            <div className="danger-confirm">
              <p className="small">
                This permanently deletes your Dragon Chat profile, messages, files, statuses and friendships.
                Groups you created are deleted for everyone. Your Caged Dragon login and your accounts in
                other Caged Dragon apps are not affected. This cannot be undone.
              </p>
              <input
                type="text"
                placeholder='Type DELETE to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoCapitalize="characters"
              />
              {deleteError && <p className="error-text small">{deleteError}</p>}
              <div className="danger-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setShowDelete(false);
                    setConfirmText('');
                    setDeleteError('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={handleDeleteAccount}
                  disabled={confirmText !== 'DELETE' || deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="legal-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          {' · '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>
        </p>

        <div className="modal-footer">
          <button type="button" className="ghost-btn" onClick={handleReset} disabled={busy}>
            Reset to default
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
