import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/css/theme.css', 'utf8');
const vars = {};
for (const m of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
const resolve = (v) => { const m = /^var\(--([\w-]+)\)$/.exec(v); return m ? resolve(vars[m[1]]) : v; };
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('brand colours', () => {
  it('uses the official palette', () => {
    expect([vars.navy, vars.leaf, vars['deep-green'], vars.orange]).toEqual(['#0D2757', '#56B847', '#146C2E', '#F27C22']);
  });
  it('maps sidebar to navy and active nav to orange', () => {
    expect(resolve(vars['sidebar-bg'])).toBe('#0D2757'); expect(resolve(vars['nav-active-bg'])).toBe('#F27C22');
  });
  it.each([['sidebar'], ['nav-active'], ['btn-primary'], ['btn-secondary']])('%s text meets WCAG AA (4.5:1)', (k) => {
    expect(ratio(resolve(vars[`${k.startsWith('btn') ? k : k}-bg`]), resolve(vars[`${k}-fg`]))).toBeGreaterThanOrEqual(4.5);
  });
  it('documents why white-on-orange / white-on-leaf are not used', () => {
    expect(ratio('#F27C22', '#FFFFFF')).toBeLessThan(4.5); expect(ratio('#56B847', '#FFFFFF')).toBeLessThan(4.5);
  });
});
