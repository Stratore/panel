import { svg, type Child } from '../lib/h.js';

/** In-house 2 px stroke icons with rounded caps (SPEC § 4.2). Decorative: aria-hidden. */
function icon(size: number, ...children: Child[]): SVGElement {
  return svg(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...children,
  );
}

const path = (d: string) => svg('path', { d });

export const icons = {
  pause: (size = 14) =>
    icon(
      size,
      svg('rect', {
        x: 6,
        y: 5,
        width: 4,
        height: 14,
        rx: 1,
        fill: 'currentColor',
        stroke: 'none',
      }),
      svg('rect', {
        x: 14,
        y: 5,
        width: 4,
        height: 14,
        rx: 1,
        fill: 'currentColor',
        stroke: 'none',
      }),
    ),
  play: (size = 14) =>
    icon(size, svg('path', { d: 'M7 5v14l12-7z', fill: 'currentColor', stroke: 'none' })),
  moon: (size = 18) => icon(size, path('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z')),
  sun: (size = 18) =>
    icon(
      size,
      svg('circle', { cx: 12, cy: 12, r: 4 }),
      path(
        'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
      ),
    ),
  settings: (size = 18) =>
    icon(
      size,
      svg('circle', { cx: 12, cy: 12, r: 3 }),
      path(
        'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
      ),
    ),
  search: (size = 18) =>
    icon(size, svg('circle', { cx: 11, cy: 11, r: 7 }), path('M20 20l-3.5-3.5')),
  journal: (size = 20) =>
    icon(size, svg('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), path('M7 9h10M7 13h6')),
  brief: (size = 20) =>
    icon(
      size,
      svg('rect', { x: 3, y: 3, width: 8, height: 8, rx: 2 }),
      svg('rect', { x: 13, y: 3, width: 8, height: 8, rx: 2 }),
      svg('rect', { x: 3, y: 13, width: 18, height: 8, rx: 2 }),
    ),
  threats: (size = 20) =>
    icon(
      size,
      path('M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z'),
      path('M12 8v5M12 16.5v.5'),
    ),
  offline: (size = 16) =>
    icon(
      size,
      path(
        'M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 5-2.4M16.6 10.8A10 10 0 0 1 19 12.5M8.5 16.1a5 5 0 0 1 7 0M12 20h.01M3 3l18 18',
      ),
    ),
};

/** The Panel mark: a rounded square with three bento blocks, the last one in accent (SPEC § 4.2). */
export function logoMark(size = 28): SVGElement {
  return svg(
    'svg',
    { width: size, height: size, viewBox: '0 0 28 28', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { class: 'base', width: 28, height: 28, rx: 8 }),
    svg('rect', { class: 'block', x: 6, y: 6, width: 7, height: 16, rx: 2 }),
    svg('rect', { class: 'block', x: 15, y: 6, width: 7, height: 7, rx: 2 }),
    svg('rect', { class: 'accent', x: 15, y: 15, width: 7, height: 7, rx: 2 }),
  );
}
