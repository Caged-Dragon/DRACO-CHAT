// Dragon Chat colour palettes, taken from the Caged Dragon logo:
// polished gold, deep black and warm cream.
//
//   dark  (default) - black surfaces, gold accents, cream text
//   light           - the inverse: cream surfaces, near-black text, deeper gold accents
//
// The same values are mirrored as CSS variables in styles.css
// (:root = dark, :root[data-theme='light'] = light). Keep both in sync.
export const DARK_PALETTE = {
  '--bg': '#050505',
  '--sidebar-bg': '#0b0b0c',
  '--panel': '#111113',
  '--panel-alt': '#1a1a1d',
  '--border': '#2c271a',
  '--text': '#f6efdc',
  '--text-dim': '#a99f85',
  '--accent-from': '#f6c94b',
  '--accent-to': '#b07818',
  '--chat-bg-color': '#050505',
  '--bubble-mine-bg': '#dba432',
  '--bubble-mine-text': '#160f00',
  '--bubble-theirs-bg': '#1a1a1d',
  '--bubble-theirs-text': '#f6efdc',
};

export const LIGHT_PALETTE = {
  '--bg': '#f6efd9',
  '--sidebar-bg': '#fffaec',
  '--panel': '#fffdf5',
  '--panel-alt': '#efe6c8',
  '--border': '#d9cb9d',
  '--text': '#15110a',
  '--text-dim': '#6a5d3a',
  '--accent-from': '#f0bb36',
  '--accent-to': '#b8801c',
  '--chat-bg-color': '#f6efd9',
  '--bubble-mine-bg': '#e0a92f',
  '--bubble-mine-text': '#15110a',
  '--bubble-theirs-bg': '#ffffff',
  '--bubble-theirs-text': '#15110a',
};

export const MODES = ['dark', 'light'];
export const DEFAULT_MODE = 'dark';

export function defaultsFor(mode) {
  return mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}
