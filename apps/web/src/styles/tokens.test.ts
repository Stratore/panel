import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.2 AA (SPEC § 0.12, § 4.2): every text/background token pair reaches 4.5:1 in both
 * themes. Translucent backgrounds are composited over the surface they sit on.
 */
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Rgba = [number, number, number, number];

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function vars(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of text.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    map.set(match[1] ?? '', (match[2] ?? '').trim());
  return map;
}

const light = vars(block(':root {'));
const darkOverrides = vars(block(":root[data-theme='dark'] {"));
const dark = new Map([...light, ...darkOverrides]);

function parse(value: string, theme: Map<string, string>): Rgba {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) return parse(theme.get(ref[1] ?? '') ?? '', theme);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] ?? '', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`Unsupported colour ${value}`);
}

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

/** [text token, background token, surface the background sits on] */
const PAIRS: readonly [string, string, string][] = [
  ['--text', '--bg', '--bg'],
  ['--text', '--card', '--card'],
  ['--sub', '--bg', '--bg'],
  ['--sub', '--card', '--card'],
  ['--accent-fg', '--accent-bg', '--card'],
  ['--accent-fg', '--card', '--card'],
  ['--inv-text', '--inv', '--inv'],
  ['--inv-sub', '--inv', '--inv'],
  ['--sev-critical-fg', '--sev-critical-bg', '--card'],
  ['--sev-critical-fg', '--card', '--card'],
  ['--sev-high-fg', '--sev-high-bg', '--card'],
  ['--sev-high-fg', '--card', '--card'],
  ['--sev-medium-fg', '--card', '--card'],
  ['--sev-low-fg', '--card', '--card'],
  ['--ok-fg', '--card', '--card'],
  ...(['ai', 'cyber', 'innovation', 'dev', 'hardware'] as const).flatMap(
    (c): [string, string, string][] => [
      [`--cat-${c}-fg`, `--cat-${c}-bg`, '--card'],
      [`--cat-${c}-fg`, '--card', '--card'],
    ],
  ),
];

describe('token contrast (WCAG AA 4.5:1)', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it.each(PAIRS)(`${name}: %s on %s`, (fg, bg, surface) => {
      const base = parse(theme.get(surface) ?? '', theme);
      const background = over(parse(theme.get(bg) ?? '', theme), base);
      const text = over(parse(theme.get(fg) ?? '', theme), background);
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('keeps the media-query dark theme identical to the forced one', () => {
    const media = vars(block(":root:not([data-theme='light']) {"));
    expect(media).toEqual(darkOverrides);
  });
});
