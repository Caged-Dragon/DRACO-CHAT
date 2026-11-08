import { DEFAULT_MODE } from './palettes.js';

export const MODE_KEY = 'dragonchat.mode';
const BROWSER_BAR = { dark: '#000000', light: '#f6efd9' };

export function getStoredMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'light' ? 'light' : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE; // storage blocked (private mode): fall back to the default
  }
}

// Sets <html data-theme>, the browser UI colour (address bar / status bar) and form-control scheme.
export function applyMode(mode, { persist = true } = {}) {
  const m = mode === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.dataset.theme = m;
  root.style.colorScheme = m;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BROWSER_BAR[m]);
  if (persist) {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }
  return m;
}
