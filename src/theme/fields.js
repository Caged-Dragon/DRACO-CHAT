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
      { key: '--bg', label: 'Page background', default: '#f6f3ff' },
      { key: '--sidebar-bg', label: 'Sidebar / friends list', default: '#ffffff' },
      { key: '--panel', label: 'Cards & panels', default: '#ffffff' },
      { key: '--panel-alt', label: 'Text boxes', default: '#f3eefc' },
      { key: '--border', label: 'Borders', default: '#e6def7' },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    icon: '🔤',
    fields: [
      { key: '--text', label: 'Main text', default: '#241a3d' },
      { key: '--text-dim', label: 'Secondary text', default: '#6b6080' },
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    icon: '🎨',
    fields: [
      { key: '--accent-from', label: 'Gradient start', default: '#dc2626' },
      { key: '--accent-to', label: 'Gradient end', default: '#7c3aed' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: '💬',
    fields: [{ key: '--chat-bg-color', label: 'Chat background', default: '#f6f3ff' }],
  },
  {
    id: 'bubbles',
    label: 'Bubbles',
    icon: '💭',
    fields: [
      { key: '--bubble-mine-bg', label: 'Your bubble', default: '#dc2626' },
      { key: '--bubble-mine-text', label: 'Your text', default: '#ffffff' },
      { key: '--bubble-theirs-bg', label: "Friend's bubble", default: '#ffffff' },
      { key: '--bubble-theirs-text', label: "Friend's text", default: '#241a3d' },
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
export function computeGradient(theme) {
  const from = theme['--accent-from'];
  const to = theme['--accent-to'];
  if (!from && !to) return undefined;
  return `linear-gradient(135deg, ${from || DEFAULT_THEME['--accent-from']} 0%, ${
    to || DEFAULT_THEME['--accent-to']
  } 100%)`;
}

// A one-click dark preset, applied via updateTheme(DARK_THEME) — still
// just normal theme values, so it plays nicely with every other part
// of the customization system (per-chat overrides can still override
// individual colors on top of it).
export const DARK_THEME = {
  '--bg': '#15121f',
  '--sidebar-bg': '#1c1830',
  '--panel': '#211c38',
  '--panel-alt': '#2a2444',
  '--border': '#3a3260',
  '--text': '#f1eefc',
  '--text-dim': '#a89fc9',
  '--accent-from': '#f97316',
  '--accent-to': '#8b5cf6',
  '--chat-bg-color': '#15121f',
  '--bubble-mine-bg': '#f97316',
  '--bubble-mine-text': '#ffffff',
  '--bubble-theirs-bg': '#2a2444',
  '--bubble-theirs-text': '#f1eefc',
};
