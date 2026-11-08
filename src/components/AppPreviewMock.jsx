// `values` is a plain object of resolved hex colors keyed by CSS
// variable name — never var() references, so this updates instantly
// as colors are picked, independent of the real stylesheet. This is
// intentionally ONE cohesive mockup of the whole app rather than a
// grid of isolated swatches, so it actually looks like Dragon Chat.
export default function AppPreviewMock({ values, wallpaperUrl }) {
  const v = (key, fallback) => values[key] || fallback;
  const gradient = `linear-gradient(135deg, ${v('--accent-from', '#ef4444')}, ${v(
    '--accent-to',
    '#8b5cf6'
  )})`;

  return (
    <div className="app-preview" style={{ background: v('--bg', '#f6f3ff') }}>
      <div className="app-preview-sidebar" style={{ background: v('--sidebar-bg', '#fff') }}>
        <div className="app-preview-brand">
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            <img src="/logo.png" alt="" className="app-preview-logo" /> Dragon Chat
          </span>
        </div>
        <div
          className="app-preview-search"
          style={{ background: v('--panel-alt', '#f3eefc'), color: v('--text-dim', '#7c718f') }}
        >
          Search
        </div>
        <div className="app-preview-friend active" style={{ background: gradient, color: '#fff' }}>
          <span className="app-preview-avatar" style={{ background: 'rgba(255,255,255,0.4)' }} />
          Ash
        </div>
        <div
          className="app-preview-friend"
          style={{ background: v('--panel', '#fff'), color: v('--text', '#241a3d') }}
        >
          <span className="app-preview-avatar" style={{ background: gradient }} />
          Priya
        </div>
      </div>

      <div
        className="app-preview-chat"
        style={{
          backgroundColor: v('--chat-bg-color', '#f6f3ff'),
          backgroundImage: wallpaperUrl ? `url("${wallpaperUrl}")` : 'none',
        }}
      >
        <div
          className="app-preview-chat-header"
          style={{ background: v('--panel', '#fff'), borderColor: v('--border', '#e6def7') }}
        >
          <span style={{ color: v('--text', '#241a3d'), fontWeight: 700 }}>Ash</span>
        </div>
        <div className="app-preview-messages">
          <div
            className="app-preview-bubble left"
            style={{
              background: v('--bubble-theirs-bg', '#fff'),
              color: v('--bubble-theirs-text', '#241a3d'),
              border: `1px solid ${v('--border', '#e6def7')}`,
            }}
          >
            Hi! 👋
          </div>
          <div
            className="app-preview-bubble right"
            style={{
              background: v('--bubble-mine-bg', '#ef4444'),
              color: v('--bubble-mine-text', '#fff'),
            }}
          >
            Hey there!
          </div>
        </div>
        <div
          className="app-preview-input-row"
          style={{ background: v('--panel', '#fff'), borderColor: v('--border', '#e6def7') }}
        >
          <div
            className="app-preview-input"
            style={{ background: v('--panel-alt', '#f3eefc'), color: v('--text-dim', '#7c718f') }}
          >
            Type a message...
          </div>
          <div className="app-preview-send" style={{ background: gradient }}>
            Send
          </div>
        </div>
      </div>
    </div>
  );
}
