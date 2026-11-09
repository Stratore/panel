import { cveTldr, cweNames, decodeCvssVector, type CveDetailDto } from '@panel/shared';
import { api, ApiError } from '../lib/api.js';
import { h, mount, svg, type Child } from '../lib/h.js';
import { formatDate, formatNumber, lang, t, type MessageKey } from '../lib/i18n.js';
import { savedCves, toggleSaved } from '../lib/saved.js';
import { toast } from '../lib/toast.js';
import { emptyState, skeleton } from './states.js';
import {
  awaitingBadge,
  externalLink,
  itemMeta,
  kevBadge,
  percent,
  severityBadge,
  severityOf,
} from './ui.js';

export interface DrawerOptions {
  /** CVE ids of the list the drawer was opened from, for Previous / Next and j / k. */
  list?: readonly string[];
  opener?: HTMLElement | null;
  /** Called with the id on display (Threats keeps `/threats/:id` in sync). */
  onShow?: (cveId: string) => void;
  onClose?: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

let current: { close: () => void } | null = null;

const decimal = (n: number) =>
  formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateOf = (value: string | null) =>
  value === null ? '—' : formatDate(value, { dateStyle: 'medium' });

function ring(score: number, severity: string): SVGElement {
  const r = 30;
  const c = 2 * Math.PI * r;
  return svg(
    'svg',
    {
      class: 'ring',
      viewBox: '0 0 72 72',
      'data-sev': severity,
      role: 'img',
      'aria-label': `CVSS ${decimal(score)}`,
    },
    svg('circle', { class: 'ring__track', cx: 36, cy: 36, r }),
    svg('circle', {
      class: 'ring__value',
      cx: 36,
      cy: 36,
      r,
      'stroke-dasharray': `${((c * score) / 10).toFixed(1)} ${c.toFixed(1)}`,
    }),
    svg('text', { x: 36, y: 42, 'text-anchor': 'middle' }, decimal(score)),
  );
}

function referenceLabel(url: string): MessageKey {
  const host = new URL(url).hostname;
  if (host.endsWith('nvd.nist.gov')) return 'drawer.refNvd';
  if (host.endsWith('cisa.gov')) return 'drawer.refKev';
  if (/exploit/i.test(url)) return 'drawer.refExploit';
  if (host.endsWith('github.com') && url.includes('/advisories/')) return 'drawer.refAdvisory';
  return 'drawer.refVendor';
}

function detail(cve: CveDetailDto): Child[] {
  const code = lang.get();
  const severity = severityOf(cve);
  // "< first fix" reads better than the first of several affected ranges (SPEC § 15 example).
  const firstFix = (cve.fixedVersions ?? '').split(/\s*[·,]\s*/)[0]?.trim();
  const hasFix = firstFix !== undefined && firstFix !== '';
  const affectedShort = hasFix
    ? `< ${firstFix}`
    : cve.affected.length === 1
      ? (cve.affected[0] ?? null)
      : null;
  const tldr = cveTldr(
    {
      product: cve.product,
      affectedShort,
      cwe: cve.cwe,
      cvss: cve.cvssEffective,
      severity,
      kev: cve.kev,
      epss: cve.epss,
      fix: cve.fixedVersions,
    },
    code,
  );
  const vector = cve.vector === null ? null : decodeCvssVector(cve.vector, code);
  const weakness = cweNames(cve.cwe, code);
  const references = [`https://nvd.nist.gov/vuln/detail/${cve.cveId}`, ...cve.references]
    .filter((url, i, all) => all.indexOf(url) === i)
    .slice(0, 12);

  return [
    h('h2', {
      class: 'drawer__title',
      attrs: { id: 'drawer-title' },
      text: cve.product ? `${cve.product} — ${weakness.short}` : weakness.short,
    }),
    h(
      'div',
      { class: 'drawer__badges' },
      severityBadge(cve),
      cve.kev ? kevBadge() : null,
      cve.kevRansomware
        ? h('span', { class: 'badge badge--kev', text: t('cve.ransomware') })
        : null,
      cve.watchlist.length > 0
        ? h('span', {
            class: 'badge badge--accent',
            text: `${t('cve.watchlist')} · ${cve.watchlist.join(', ')}`,
          })
        : null,
      cve.hasPublicExploit
        ? h('span', { class: 'badge', data: { sev: 'high' }, text: t('cve.exploit') })
        : null,
      cve.cvssProvisional ? awaitingBadge() : null,
    ),
    h(
      'div',
      { class: 'tldr' },
      h('span', { class: 'section-label', text: t('drawer.tldr') }),
      h('p', { text: tldr }),
    ),
    h(
      'div',
      { class: 'stats' },
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat__label', text: t('drawer.cvss') }),
        ring(cve.cvssEffective, severity),
      ),
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat__label', text: t('drawer.epss') }),
        h('span', {
          class: 'stat__value',
          text: cve.epss === null ? t('drawer.unknown') : percent(cve.epss),
        }),
        cve.epss === null
          ? null
          : h(
              'span',
              { class: 'bar', attrs: { 'aria-hidden': 'true' } },
              h('span', {
                style: {
                  '--w': `${String(Math.round(cve.epss * 100))}%`,
                  '--c': 'var(--sev-high)',
                },
              }),
            ),
        cve.epssPercentile === null
          ? null
          : h('span', {
              class: 'stat__label',
              text: t('drawer.epssHint', { pct: percent(1 - cve.epssPercentile) }),
            }),
      ),
      h(
        'div',
        { class: 'stat' },
        h('span', {
          class: 'stat__label',
          text: cve.kevDue ? t('drawer.deadline') : t('drawer.fix'),
        }),
        h('span', {
          class: 'stat__value',
          text: cve.kevDue ? dateOf(cve.kevDue) : (cve.fixedVersions ?? t('cve.noFix')),
        }),
        cve.kevDue ? h('span', { class: 'stat__label', text: t('drawer.deadlineHint') }) : null,
      ),
    ),
    vector
      ? h(
          'div',
          { class: 'vector', attrs: { 'aria-label': cve.vector ?? '' } },
          vector.metrics
            .slice(0, 4)
            .map((m) =>
              h(
                'span',
                { class: 'badge' },
                `${m.name} `,
                h('strong', { text: m.label }),
                h('span', { class: 'mono sub', text: ` ${m.code}` }),
              ),
            ),
        )
      : null,
    h(
      'dl',
      { class: 'kv' },
      h('dt', { text: t('drawer.affected') }),
      h('dd', { class: 'mono', text: cve.affected.length > 0 ? cve.affected.join(' · ') : '—' }),
      h('dt', { text: t('drawer.fix') }),
      h('dd', { class: 'mono', text: cve.fixedVersions ?? t('cve.noFix') }),
      h('dt', { text: t('drawer.weakness') }),
      h('dd', { text: cve.cwe ? `${cve.cwe} · ${weakness.long}` : '—' }),
    ),
    h(
      'div',
      { style: { display: 'grid', gap: '10px' } },
      h('h3', { class: 'section-label', text: t('drawer.timeline') }),
      h(
        'ol',
        { class: 'timeline' },
        h('li', null, t('drawer.published'), h('strong', { text: dateOf(cve.published) })),
        cve.kevAdded
          ? h('li', null, t('drawer.kevAdded'), h('strong', { text: dateOf(cve.kevAdded) }))
          : null,
        h('li', null, t('drawer.modified'), h('strong', { text: dateOf(cve.modified) })),
      ),
    ),
    h(
      'div',
      { style: { display: 'grid', gap: '10px' } },
      h('h3', { class: 'section-label', text: t('drawer.references') }),
      h(
        'ul',
        { class: 'refs' },
        references.map((url) =>
          h(
            'li',
            null,
            externalLink(
              url,
              [
                h('span', { text: url.replace(/^https?:\/\//, '') }),
                h('span', { class: 'badge', text: t(referenceLabel(url)) }),
              ],
              { label: url },
            ),
          ),
        ),
      ),
    ),
    cve.articles.length > 0
      ? h(
          'div',
          { style: { display: 'grid', gap: '6px' } },
          h('h3', { class: 'section-label', text: t('drawer.news', { n: cve.articles.length }) }),
          h(
            'ul',
            { class: 'mini-list' },
            cve.articles.map((a) =>
              h(
                'li',
                null,
                externalLink(a.url, [
                  h('span', { class: 'mini-list__title', attrs: { lang: a.lang }, text: a.title }),
                  itemMeta(a),
                ]),
              ),
            ),
          ),
        )
      : null,
  ];
}

/** Opens the CVE detail panel (SPEC § 4.3 C): modal dialog, focus trap, Esc, j / k, s, o. */
export function openCveDrawer(cveId: string, options: DrawerOptions = {}): void {
  current?.close();
  const opener =
    options.opener ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const list = options.list ?? [cveId];
  let index = Math.max(0, list.indexOf(cveId));
  let shownId = cveId;

  const app = document.querySelector('pn-app-shell');
  const body = h('div', { class: 'drawer__scroll' });
  const idLabel = h('span', { class: 'drawer__id' });
  const nvdLink = h('span');
  const saveButton = h('button', {
    class: 'pn-iconbtn',
    attrs: { type: 'button', 'aria-keyshortcuts': 's' },
  });
  const position = h('span', { class: 'mono sub' });
  const prev = h('button', {
    class: 'btn btn--ghost',
    attrs: { type: 'button', 'aria-keyshortcuts': 'k' },
    text: `‹ ${t('drawer.previous')}`,
  });
  const next = h('button', {
    class: 'btn btn--ghost',
    attrs: { type: 'button', 'aria-keyshortcuts': 'j' },
    text: `${t('drawer.next')} ›`,
  });
  const closeButton = h('button', {
    class: 'pn-iconbtn',
    attrs: { type: 'button', 'aria-label': t('drawer.close') },
    text: '✕',
  });

  const panel = h(
    'div',
    {
      class: 'drawer',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'drawer-title',
        'aria-describedby': 'drawer-id',
      },
    },
    h(
      'div',
      { class: 'drawer__scroll', style: { 'padding-bottom': '0', flex: 'none' } },
      h(
        'div',
        { class: 'drawer__head' },
        idLabel,
        h('div', { style: { display: 'flex', gap: '8px' } }, nvdLink, saveButton, closeButton),
      ),
    ),
    body,
    h('div', { class: 'drawer__foot' }, prev, position, next),
  );
  idLabel.id = 'drawer-id';
  const scrim = h('div', { class: 'scrim', attrs: { 'aria-hidden': 'true' } });

  const updateSave = () => {
    const isSaved = savedCves.get().has(shownId);
    saveButton.setAttribute('aria-pressed', String(isSaved));
    saveButton.textContent = isSaved ? `★ ${t('drawer.saved')}` : `☆ ${t('drawer.save')}`;
  };

  const show = async (id: string) => {
    shownId = id;
    idLabel.textContent = id;
    mount(
      nvdLink,
      externalLink(`https://nvd.nist.gov/vuln/detail/${id}`, `${t('drawer.nvd')} ↗`, {
        class: 'pn-iconbtn',
        label: t('drawer.refNvd'),
      }),
    );
    position.textContent =
      list.length > 1 ? t('drawer.position', { n: index + 1, total: list.length }) : '';
    prev.disabled = index <= 0;
    next.disabled = index >= list.length - 1;
    updateSave();
    mount(
      body,
      h(
        'div',
        null,
        h('h2', { class: 'visually-hidden', attrs: { id: 'drawer-title' }, text: id }),
        skeleton({ height: '30px' }),
        h('div', { style: { height: '16px' } }),
        skeleton({ lines: 6 }),
      ),
    );
    options.onShow?.(id);
    try {
      const cve = await api.cve(id);
      if (shownId !== id) return;
      mount(body, ...detail(cve));
    } catch (error) {
      if (shownId !== id) return;
      const missing = error instanceof ApiError && error.status === 404;
      mount(
        body,
        h('h2', { class: 'drawer__title', attrs: { id: 'drawer-title' }, text: id }),
        emptyState(t(missing ? 'drawer.notFound' : 'state.error')),
      );
    }
    body.scrollTop = 0;
  };

  const go = (delta: number) => {
    const target = list[index + delta];
    if (target === undefined) return;
    index += delta;
    void show(target);
  };

  const close = () => {
    panel.remove();
    scrim.remove();
    app?.removeAttribute('inert');
    document.body.style.removeProperty('overflow');
    document.removeEventListener('keydown', onKey, true);
    current = null;
    options.onClose?.();
    opener?.focus({ preventScroll: true });
  };

  const onKey = (event: KeyboardEvent) => {
    const typing =
      event.target instanceof HTMLElement && event.target.matches('input, textarea, select');
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'j') go(1);
    else if (event.key === 'k') go(-1);
    else if (event.key === 's') saveButton.click();
    else if (event.key === 'o')
      window.open(`https://nvd.nist.gov/vuln/detail/${shownId}`, '_blank', 'noopener,noreferrer');
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  // Swipe down to close on phones (SPEC § 4.3 C).
  let touchStart: number | null = null;
  panel.addEventListener(
    'touchstart',
    (e) => {
      touchStart = body.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    },
    { passive: true },
  );
  panel.addEventListener('touchend', (e) => {
    const end = e.changedTouches[0]?.clientY;
    if (touchStart !== null && end !== undefined && end - touchStart > 90) close();
    touchStart = null;
  });

  prev.addEventListener('click', () => {
    go(-1);
  });
  next.addEventListener('click', () => {
    go(1);
  });
  closeButton.addEventListener('click', close);
  scrim.addEventListener('click', close);
  saveButton.addEventListener('click', () => {
    const saved = toggleSaved(shownId);
    updateSave();
    toast(saved ? t('drawer.saved') : t('drawer.save'));
  });

  document.body.append(scrim, panel);
  app?.setAttribute('inert', '');
  document.body.style.setProperty('overflow', 'hidden');
  document.addEventListener('keydown', onKey, true);
  current = { close };
  void show(cveId).then(() => {
    closeButton.focus({ preventScroll: true });
  });
}

export const closeCveDrawer = (): void => {
  current?.close();
};
