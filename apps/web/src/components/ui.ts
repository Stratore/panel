import {
  cweNames,
  severityFromCvss,
  type Category,
  type CveSummaryDto,
  type ItemDto,
  type Severity,
} from '@panel/shared';
import { h, isSafeUrl, svg, type Child } from '../lib/h.js';
import { formatAge, formatNumber, t, type MessageKey } from '../lib/i18n.js';

/** Section name (SPEC § 4.2 rubriques). */
export const categoryName = (category: Category): string => t(`cat.${category}`);

/** External link: new tab, no opener, no referrer; unsafe URLs render as plain text. */
export function externalLink(
  href: string,
  children: Child | Child[],
  options: { class?: string; label?: string } = {},
): HTMLElement {
  if (!isSafeUrl(href) || href.startsWith('/'))
    return h('span', options.class ? { class: options.class } : null, children);
  return h(
    'a',
    {
      ...(options.class ? { class: options.class } : {}),
      attrs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        ...(options.label
          ? { 'aria-label': t('common.externalLink', { label: options.label }) }
          : {}),
      },
    },
    children,
  );
}

/** "Ars Technica [EN] 2 h · 3 sources" */
export function itemMeta(item: ItemDto, now = new Date()): HTMLElement {
  return h(
    'span',
    { class: 'meta' },
    h('span', { class: 'meta__source', text: item.sourceName }),
    h('span', { class: 'lang-tag', attrs: { lang: 'en' }, text: item.lang.toUpperCase() }),
    h('time', { attrs: { datetime: item.publishedAt }, text: formatAge(item.publishedAt, now) }),
    item.clusterSize > 1
      ? h('span', { text: `· ${t('journal.sources', { n: item.clusterSize })}` })
      : null,
  );
}

export function severityOf(cve: Pick<CveSummaryDto, 'severity' | 'cvssEffective'>): Severity {
  return cve.severity ?? severityFromCvss(cve.cvssEffective);
}

const decimal = (n: number) =>
  formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function severityBadge(cve: CveSummaryDto): HTMLElement {
  const severity = severityOf(cve);
  return h(
    'span',
    { class: 'badge badge--mono', data: { sev: severity } },
    `${t(`cve.severity.${severity}` as MessageKey)} · ${decimal(cve.cvssEffective)}`,
  );
}

export const kevBadge = (): HTMLElement =>
  h(
    'span',
    { class: 'badge badge--kev' },
    h('span', { class: 'live-dot', attrs: { 'aria-hidden': 'true' } }),
    `${t('cve.exploited')} · ${t('cve.kev')}`,
  );

export const awaitingBadge = (): HTMLElement =>
  h('span', { class: 'badge', text: t('cve.awaiting') });

/** "PHP — Out-of-bounds write" */
export function cveTitle(
  cve: Pick<CveSummaryDto, 'product' | 'cwe' | 'cveId'>,
  lang: 'en' | 'fr',
): string {
  const weakness = cweNames(cve.cwe, lang).short;
  return cve.product ? `${cve.product} · ${weakness}` : weakness;
}

export const percent = (value: number): string =>
  value > 0 && value < 0.01
    ? '<1%'
    : formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });

/** One CVE line, shared by the Brief priority queue and the Threats list (SPEC § 4.3 B). */
export function cveRow(
  cve: CveSummaryDto,
  lang: 'en' | 'fr',
  onOpen: (cve: CveSummaryDto, opener: HTMLElement) => void,
): HTMLElement {
  const severity = severityOf(cve);
  const row = h(
    'button',
    {
      class: 'cve-row',
      data: { sev: severity, cve: cve.cveId },
      attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    },
    h('span', { class: 'cve-row__bar', attrs: { 'aria-hidden': 'true' } }),
    h(
      'span',
      { class: 'cve-row__main' },
      h(
        'span',
        { class: 'cve-row__top' },
        h('span', { class: 'cve-row__id', text: cve.cveId }),
        cve.kev ? kevBadge() : null,
        cve.watchlist.map((label) => h('span', { class: 'badge badge--accent', text: label })),
        cve.cvssProvisional ? awaitingBadge() : null,
      ),
      h('span', { class: 'cve-row__title', text: cveTitle(cve, lang) }),
      h('span', {
        class: 'cve-row__fix',
        text: cve.fixedVersions
          ? t('cve.fixedIn', { versions: cve.fixedVersions })
          : t('cve.noFix'),
      }),
    ),
    h(
      'span',
      { class: 'cve-row__side' },
      h('span', {
        class: 'badge badge--mono',
        data: { sev: severity },
        text: `CVSS ${decimal(cve.cvssEffective)}`,
      }),
      cve.epss === null
        ? null
        : h(
            'span',
            { class: 'epss-mini' },
            h(
              'span',
              { class: 'bar', attrs: { 'aria-hidden': 'true' } },
              h('span', {
                style: {
                  '--w': `${String(Math.round(cve.epss * 100))}%`,
                  '--c': 'var(--sev-high)',
                },
              }),
            ),
            t('cve.epss', { value: percent(cve.epss) }),
          ),
      cve.published
        ? h('time', { attrs: { datetime: cve.published }, text: formatAge(cve.published) })
        : null,
    ),
  );
  row.addEventListener('click', () => {
    onOpen(cve, row);
  });
  return row;
}

/** Hand-drawn sparkline (SPEC § 2: SVG, no library), drawn progressively by CSS. */
export function sparkline(values: readonly number[], label: string): SVGElement {
  const width = 96;
  const height = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)] as const);
  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${String(width)} ${String(height)} L0 ${String(height)} Z`;
  const length = points.reduce((sum, [x, y], i) => {
    const prev = points[i - 1];
    return prev ? sum + Math.hypot(x - prev[0], y - prev[1]) : sum;
  }, 0);
  const el = svg(
    'svg',
    {
      class: 'spark',
      viewBox: `0 0 ${String(width)} ${String(height)}`,
      role: 'img',
      'aria-label': label,
    },
    svg('path', { class: 'spark__area', d: area }),
    svg('path', { d: line }),
  );
  el.style.setProperty('--len', String(Math.ceil(length)));
  return el;
}

/** Real switch (SPEC § 4.3 D): `<button role="switch" aria-checked>`. */
export function switchButton(options: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): HTMLButtonElement {
  const button = h(
    'button',
    {
      class: 'switch',
      attrs: {
        type: 'button',
        role: 'switch',
        'aria-checked': String(options.checked),
        'aria-label': options.label,
      },
    },
    h('span', { class: 'switch__track' }, h('span', { class: 'switch__knob' })),
  );
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    options.onChange(next);
  });
  return button;
}

export function sectionHead(title: string, id: string, extra?: Child): HTMLElement {
  return h(
    'div',
    { class: 'box__head' },
    h('h2', { class: 'box__title', attrs: { id }, text: title }),
    extra ?? null,
  );
}

/** Inline SVG check / cross for validation lists. */
export function checkIcon(ok: boolean): SVGElement {
  return svg(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svg('path', { d: ok ? 'M5 12l5 5 9-10' : 'M6 6l12 12M18 6L6 18' }),
  );
}
