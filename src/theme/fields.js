import { DARK_PALETTE } from './palettes.js';

// Every customizable color, grouped into tabs. Unlike a per-field
// preview, the settings UI now shows ONE live mockup of the whole app
// (sidebar + chat, side by side) that updates as any field changes —
// these tabs just organize the controls that feed it.
export const THEME_TABS = [
  {
    id: 'layout',
    label: 'Layout',
    icon: '🖼️',
    fields: [
      { key: '--bg', label: 'Page background', default: DARK_PALETTE['--bg'] },
      { key: '--sidebar-bg', label: 'Sidebar / friends list', default: DARK_PALETTE['--sidebar-bg'] },
      { key: '--panel', label: 'Cards & panels', default: DARK_PALETTE['--panel'] },
      { key: '--panel-alt', label: 'Text boxes', default: DARK_PALETTE['--panel-alt'] },
      { key: '--border', label: 'Borders', default: DARK_PALETTE['--border'] },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    icon: '🔤',
    fields: [
      { key: '--text', label: 'Main text', default: DARK_PALETTE['--text'] },
      { key: '--text-dim', label: 'Secondary text', default: DARK_PALETTE['--text-dim'] },
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    icon: '🎨',
    fields: [
      { key: '--accent-from', label: 'Gradient start', default: DARK_PALETTE['--accent-from'] },
      { key: '--accent-to', label: 'Gradient end', default: DARK_PALETTE['--accent-to'] },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: '💬',
    fields: [{ key: '--chat-bg-color', label: 'Chat background', default: DARK_PALETTE['--chat-bg-color'] }],
  },
  {
    id: 'bubbles',
    label: 'Bubbles',
    icon: '💭',
    fields: [
      { key: '--bubble-mine-bg', label: 'Your bubble', default: DARK_PALETTE['--bubble-mine-bg'] },
      { key: '--bubble-mine-text', label: 'Your text', default: DARK_PALETTE['--bubble-mine-text'] },
      { key: '--bubble-theirs-bg', label: "Friend's bubble", default: DARK_PALETTE['--bubble-theirs-bg'] },
      { key: '--bubble-theirs-text', label: "Friend's text", default: DARK_PALETTE['--bubble-theirs-text'] },
    ],
  },
];

// Flattened, de-duplicated list of every field — used to build the
// full default theme object.
export const COLOR_FIELDS = THEME_TABS.flatMap((t) => t.fields).reduce((acc, f) => {
  if (!acc.find((x) => x.key === f.key)) acc.push(f);
  return acc;
}, []);

export const DEFAULT_THEME = COLOR_FIELDS.reduce((acc, f) => {
  acc[f.key] = f.default;
  return acc;
}, {});

// The rest of the stylesheet references a single var(--gradient) for
// every accent use (buttons, active states, "mine" bubbles, etc).
// Since accent color is edited as two separate pickers (start/end),
// this combines them into that one gradient value.
// Returns undefined if neither accent color is present in `theme` —
// used for per-chat overrides, where "not present" should mean
// "inherit the global gradient" rather than reset to defaults.
export function computeGradient(theme, fallback = DEFAULT_THEME) {
  const from = theme['--accent-from'];
  const to = theme['--accent-to'];
  if (!from && !to) return undefined;
  return `linear-gradient(135deg, ${from || fallback['--accent-from']} 0%, ${
    to || fallback['--accent-to']
  } 100%)`;
}
