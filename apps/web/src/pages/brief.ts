import type { BriefDto } from '@panel/shared';
import { POLL_EVENT } from '../app-context.js';
import { openCveDrawer } from '../components/drawer.js';
import { emptyState, skeleton } from '../components/states.js';
import { cveRow, externalLink, itemMeta, sectionHead, sparkline } from '../components/ui.js';
import { api } from '../lib/api.js';
import { loadView } from '../lib/data.js';
import { h, mount } from '../lib/h.js';
import {
  formatAge,
  formatCompact,
  formatDate,
  formatNumber,
  lang,
  t,
  type MessageKey,
} from '../lib/i18n.js';
import { countUp } from '../lib/motion.js';
import { isDemo } from '../lib/state.js';

function greetingKey(now: Date): MessageKey {
  const hour = now.getHours();
  if (hour < 12) return 'brief.morning';
  if (hour < 18) return 'brief.afternoon';
  return 'brief.evening';
}

const signed = (delta: number) =>
  `${delta > 0 ? '+' : ''}${formatNumber(delta, { style: 'percent', maximumFractionDigits: 0 })}`;

/** `/brief`: the cyber dashboard (SPEC § 4.3 B). */
export class PnBriefPage extends HTMLElement {
  private visited = false;
  private readonly onPoll = () => {
    void this.load();
  };

  connectedCallback(): void {
    mount(
      this,
      h('div', { class: 'greeting' }, skeleton({ height: '52px', width: '60%' })),
      h(
        'div',
        { class: 'bento' },
        [0, 1, 2, 3].map(() => h('div', { class: 'box kpi s3' }, skeleton({ lines: 3 }))),
      ),
    );
    document.addEventListener(POLL_EVENT, this.onPoll);
    void this.load();
  }

  disconnectedCallback(): void {
    document.removeEventListener(POLL_EVENT, this.onPoll);
  }

  private async load(): Promise<void> {
    try {
      await loadView(
        'brief',
        () => api.brief(),
        ({ value }) => {
          this.render(value);
        },
      );
      // "New since your last visit" (SPEC § 10): the visit counts once the brief is on screen.
      if (!this.visited && !isDemo) {
        this.visited = true;
        void api.visit().catch(() => undefined);
      }
    } catch {
      mount(
        this,
        h('div', { class: 'box', style: { 'margin-top': '40px' } }, emptyState(t('state.error'))),
      );
    }
  }

  private render(data: BriefDto): void {
    const now = new Date();
    const code = lang.get();
    const greeting = t(greetingKey(now));
    const title =
      data.displayName === ''
        ? t('brief.greetingAnon', { greeting })
        : t('brief.greeting', { greeting, name: data.displayName });
    const subtitle =
      data.lastVisitAt === null
        ? t('brief.firstVisit')
        : `${t('brief.sinceVisit', { n: data.newSinceLastVisit })}${data.attention > 0 ? ` ${t('brief.attention', { n: data.attention })}` : ''}`;

    const ids = data.priority.map((c) => c.cveId);
    const open = (cve: { cveId: string }, opener: HTMLElement) => {
      openCveDrawer(cve.cveId, { list: ids, opener });
    };

    mount(
      this,
      h(
        'section',
        { class: 'greeting' },
        h('span', {
          class: 'eyebrow',
          text: `${formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatDate(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`,
        }),
        h('h1', {
          class: 'greeting__title',
          attrs: { id: 'page-title', tabindex: -1 },
          text: title,
        }),
        h('p', { class: 'greeting__sub', text: subtitle }),
      ),
      h(
        'div',
        { class: 'bento' },
        this.kpi('brief.kpiNew', data.kpis.newCves, 'var(--accent)', 'd1'),
        this.kpi('brief.kpiCritical', data.kpis.critical, 'var(--sev-critical)', 'd2'),
        this.kpi(
          'brief.kpiExploited',
          data.kpis.exploited,
          'var(--sev-high)',
          'd3',
          t('brief.kevWeek'),
        ),
        this.kpi(
          'brief.kpiWatchlist',
          data.kpis.watchlist,
          'var(--cat-ai)',
          'd4',
          data.watchlist
            .filter((w) => w.count > 0)
            .map((w) => w.label)
            .slice(0, 3)
            .join(', '),
        ),
        h(
          'section',
          { class: 'box s8 r2 d3', attrs: { 'aria-labelledby': 'prio-title' } },
          sectionHead(
            t('brief.priority'),
            'prio-title',
            h('a', { class: 'link-accent', attrs: { href: '/threats' }, text: t('brief.viewAll') }),
          ),
          data.priority.length === 0
            ? emptyState(t('brief.noThreats'))
            : h(
                'div',
                { class: 'cve-list' },
                data.priority.map((cve) => cveRow(cve, code, open)),
              ),
        ),
        this.watchlist(data),
        this.breach(data),
        this.stories(data, now),
        this.trending(data),
        this.releases(data),
      ),
    );
  }

  private kpi(
    label: MessageKey,
    kpi: BriefDto['kpis']['newCves'],
    color: string,
    delay: string,
    hint?: string,
  ): HTMLElement {
    const value = h('span', { class: 'kpi__value' });
    countUp(value, kpi.value, (n) => formatNumber(n));
    const detail =
      hint !== undefined && hint !== ''
        ? hint
        : kpi.delta === null
          ? t('brief.noHistory')
          : t('brief.vs7d', { delta: signed(kpi.delta) });
    return h(
      'section',
      { class: `box box--hover kpi s3 ${delay}`, style: { '--c': color } },
      h(
        'h2',
        { class: 'kpi__label' },
        h('span', { class: 'dot-c', attrs: { 'aria-hidden': 'true' } }),
        t(label),
      ),
      h(
        'div',
        { class: 'kpi__row' },
        value,
        sparkline(kpi.spark, `${t(label)}: ${kpi.spark.join(', ')}`),
      ),
      h('p', { class: 'kpi__delta', text: detail }),
    );
  }

  private watchlist(data: BriefDto): HTMLElement {
    const max = Math.max(1, ...data.watchlist.map((w) => w.count));
    return h(
      'section',
      { class: 'box s4 d4', attrs: { 'aria-labelledby': 'wl-title' } },
      sectionHead(
        t('brief.watchlist'),
        'wl-title',
        h('span', {
          class: 'sub',
          style: { 'font-size': '12.5px' },
          text: t('brief.watchlistHint'),
        }),
      ),
      h(
        'div',
        null,
        data.watchlist.map((w) =>
          h(
            'a',
            { class: 'wl-row', attrs: { href: `/threats?tech=${encodeURIComponent(w.id)}` } },
            h('span', { text: w.label }),
            h(
              'span',
              { class: 'bar', attrs: { 'aria-hidden': 'true' } },
              h('span', {
                style: {
                  '--w': `${String(Math.round((w.count / max) * 100))}%`,
                  '--c': w.count > 0 ? 'var(--accent)' : 'var(--track)',
                },
              }),
            ),
            h('span', { class: 'mono', text: String(w.count) }),
          ),
        ),
      ),
    );
  }

  private breach(data: BriefDto): HTMLElement {
    const b = data.latestBreach;
    return h(
      'section',
      { class: 'box box--inv breach-card s4 d5', attrs: { 'aria-labelledby': 'breach-title' } },
      h('h2', {
        class: 'box__title',
        attrs: { id: 'breach-title' },
        text: t('brief.latestBreach'),
      }),
      b === null
        ? h('p', { class: 'sub', text: t('breaches.empty') })
        : [
            h('p', { style: { 'font-size': '17px', 'font-weight': '600' }, text: b.title }),
            h('p', {
              class: 'breach-card__accounts',
              text: t('brief.accounts', { n: formatCompact(b.accounts) }),
            }),
            h('p', { class: 'sub', text: b.dataClasses.slice(0, 4).join(' · ') }),
            h('p', { class: 'sub', text: t('breaches.added', { date: formatDate(b.addedDate) }) }),
          ],
      externalLink('https://haveibeenpwned.com/PwnedWebsites', `${t('breaches.attribution')} ↗`, {
        label: t('breaches.attribution'),
      }),
    );
  }

  private stories(data: BriefDto, now: Date): HTMLElement {
    return h(
      'section',
      { class: 'box s4 d4', attrs: { 'aria-labelledby': 'stories-title' } },
      sectionHead(
        t('brief.topStories'),
        'stories-title',
        h('a', { class: 'link-accent', attrs: { href: '/' }, text: t('common.seeAll') }),
      ),
      data.topStories.length === 0
        ? emptyState(t('state.empty'))
        : h(
            'ul',
            { class: 'mini-list' },
            data.topStories.map((s) =>
              h(
                'li',
                null,
                externalLink(s.url, [
                  h('span', { class: 'mini-list__title', attrs: { lang: s.lang }, text: s.title }),
                  itemMeta(s, now),
                ]),
              ),
            ),
          ),
    );
  }

  private trending(data: BriefDto): HTMLElement {
    return h(
      'section',
      { class: 'box s4 d5', attrs: { 'aria-labelledby': 'trend-title' } },
      sectionHead(t('brief.trending'), 'trend-title'),
      data.trending.length === 0
        ? emptyState(t('state.empty'))
        : h(
            'ul',
            { class: 'mini-list' },
            data.trending.map((r) =>
              h(
                'li',
                null,
                externalLink(r.url, [
                  h('span', { class: 'mini-list__title mono', text: r.fullName }),
                  h(
                    'span',
                    { class: 'meta' },
                    r.language ? h('span', { text: r.language }) : null,
                    h('span', { text: `★ ${formatCompact(r.stars)}` }),
                    r.starsToday > 0
                      ? h('span', {
                          class: 'badge badge--accent',
                          text: t('brief.starsToday', { n: formatNumber(r.starsToday) }),
                        })
                      : null,
                  ),
                ]),
              ),
            ),
          ),
    );
  }

  private releases(data: BriefDto): HTMLElement {
    return h(
      'section',
      { class: 'box s4 d6', attrs: { 'aria-labelledby': 'rel-title' } },
      sectionHead(
        t('brief.releases'),
        'rel-title',
        h('a', { class: 'link-accent', attrs: { href: '/releases' }, text: t('common.seeAll') }),
      ),
      data.releases.length === 0
        ? emptyState(t('releases.empty'))
        : h(
            'ul',
            { class: 'mini-list' },
            data.releases.map((r) =>
              h(
                'li',
                null,
                externalLink(r.url, [
                  h(
                    'span',
                    { class: 'mini-list__title' },
                    `${r.product} `,
                    h('span', { class: 'mono', text: r.version }),
                  ),
                  h(
                    'span',
                    { class: 'meta' },
                    r.isSecurity
                      ? h('span', {
                          class: 'badge',
                          data: { sev: 'critical' },
                          text: t('releases.security'),
                        })
                      : null,
                    h('span', { text: formatAge(r.publishedAt) }),
                  ),
                ]),
              ),
            ),
          ),
    );
  }
}
