import { useTheme } from '../contexts/ThemeContext.jsx';

// Sun/moon button that flips Dragon Chat between its dark (default) and light looks.
export default function ThemeToggle({ className = '' }) {
  const { mode, toggleMode } = useTheme();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleMode}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {mode === 'dark' ? (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
          <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a.6.6 0 0 0-.8-.7A9.5 9.5 0 1 0 21.2 15a.6.6 0 0 0-.7-.8z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
