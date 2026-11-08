import { describe, it, expect } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE, defaultsFor, DEFAULT_MODE } from './palettes.js';
import { THEME_TABS } from './fields.js';

// WCAG relative luminance / contrast
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme palettes', () => {
  it('defaults to dark', () => {
    expect(DEFAULT_MODE).toBe('dark');
    expect(defaultsFor('dark')).toBe(DARK_PALETTE);
    expect(defaultsFor('light')).toBe(LIGHT_PALETTE);
    expect(defaultsFor('anything-else')).toBe(DARK_PALETTE);
  });
  it('defines the same colours in both modes, and every customizable field has one', () => {
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual(Object.keys(DARK_PALETTE).sort());
    for (const tab of THEME_TABS) for (const f of tab.fields) expect(DARK_PALETTE[f.key], f.key).toBeTruthy();
  });
  it('dark mode is genuinely dark and light mode genuinely light', () => {
    expect(lum(DARK_PALETTE['--bg'])).toBeLessThan(0.02);
    expect(lum(LIGHT_PALETTE['--bg'])).toBeGreaterThan(0.7);
  });
  for (const [name, p] of [['dark', DARK_PALETTE], ['light', LIGHT_PALETTE]]) {
    it(`${name}: text stays readable on every surface`, () => {
      for (const surface of ['--bg', '--sidebar-bg', '--panel', '--panel-alt']) {
        expect(ratio(p['--text'], p[surface]), `text on ${surface}`).toBeGreaterThanOrEqual(7);
        expect(ratio(p['--text-dim'], p[surface]), `dim text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(p['--bubble-mine-text'], p['--bubble-mine-bg'])).toBeGreaterThanOrEqual(7);
      expect(ratio(p['--bubble-theirs-text'], p['--bubble-theirs-bg'])).toBeGreaterThanOrEqual(7);
    });
  }
});
