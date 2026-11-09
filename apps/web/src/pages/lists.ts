import {
  CVE_FILTERS,
  CVE_SORTS,
  type BreachDto,
  type CveSummaryDto,
  type ReleaseDto,
  type WatchlistEntry,
} from '@panel/shared';
import { router } from '../app-context.js';
import { closeCveDrawer, openCveDrawer } from '../components/drawer.js';
import { emptyState, skeleton } from '../components/states.js';
import { cveRow, externalLink } from '../components/ui.js';
import { api, type Page } from '../lib/api.js';
import { h, mount } from '../lib/h.js';
import { formatCompact, formatDate, lang, t, type MessageKey } from '../lib/i18n.js';

type CveFilter = (typeof CVE_FILTERS)[number];
type CveSort = (typeof CVE_SORTS)[number];

const PAGE_SIZE = 25;

/** Infinite list: an IntersectionObserver loads the next page, with a button as fallback. */
abstract class PagedList<T> extends HTMLElement {
  protected items: T[] = [];
  protected cursor: string | null = null;
  protected loading = false;
  private observer: IntersectionObserver | null = null;
  protected readonly list = h('div');
  protected readonly more = h('div', { class: 'load-more' });

  protected abstract fetchPage(cursor: string | null): Promise<Page<T>>;
  protected abstract renderItem(item: T): HTMLElement;
  protected abstract emptyText(): string;

  protected async reset(): Promise<void> {
    this.items = [];
    this.cursor = null;
    mount(this.list, skeleton({ height: '56px', lines: 6 }));
    await this.loadMore(true);
  }

  protected async loadMore(first = false): Promise<void> {
    if (this.loading || (!first && this.cursor === null)) return;
    this.loading = true;
    try {
      const page = await this.fetchPage(first ? null : this.cursor);
      if (first) this.list.replaceChildren();
      this.items.push(...page.items);
      this.cursor = page.nextCursor;
      for (const item of page.items) this.list.append(this.renderItem(item));
      if (this.items.length === 0) mount(this.list, emptyState(this.emptyText()));
      this.afterLoad();
    } catch {
      if (first) mount(this.list, emptyState(t('state.error')));
    } finally {
      this.loading = false;
      this.renderMore();
    }
  }

  protected afterLoad(): void {
    // Hook for subclasses.
  }

  private renderMore(): void {
    if (this.cursor === null) {
      this.more.replaceChildren();
      return;
    }
    mount(
      this.more,
      h('button', {
        class: 'btn btn--ghost',
        attrs: { type: 'button' },
        text: t('common.loadMore'),
        on: { click: () => void this.loadMore() },
      }),
    );
  }

  protected observe(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void this.loadMore();
      },
      { rootMargin: '400px' },
    );
    this.observer.observe(this.more);
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
  }
}

/** `/threats` and `/threats/:id` (SPEC § 4.3 F): filters in the URL, sort, two views. */
export class PnThreatsPage extends PagedList<CveSummaryDto> {
  private filters = new Set<CveFilter>();
  private tech: string | null = null;
  private sort: CveSort = 'priority';
  private view: 'compact' | 'cards' = 'compact';
  private watchlist: WatchlistEntry[] = [];
  private toolbar = h('div');
  private drawerOpen = false;

  private readonly onKey = (event: KeyboardEvent) => {
    if (this.drawerOpen || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select'))
      return;
    if (event.key !== 'j' && event.key !== 'k') return;
    const rows = [...this.list.querySelectorAll<HTMLElement>('.cve-row')];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const target =
      rows[
        Math.min(rows.length - 1, Math.max(0, at === -1 ? 0 : at + (event.key === 'j' ? 1 : -1)))
      ];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    event.preventDefault();
  };

  connectedCallback(): void {
    const { query, params } = router.route.get();
    this.filters = new Set(
      (query.get('filter') ?? '')
        .split(',')
        .filter(
          (f): f is CveFilter => (CVE_FILTERS as readonly string[]).includes(f) && f !== 'all',
        ),
    );
    this.tech = query.get('tech');
    const sort = query.get('sort');
    if (sort !== null && (CVE_SORTS as readonly string[]).includes(sort))
      this.sort = sort as CveSort;
    if (query.get('view') === 'cards') this.view = 'cards';

    mount(
      this,
      h('h1', {
        class: 'page-title',
        attrs: { id: 'page-title', tabindex: -1 },
        text: t('page.threats'),
      }),
      this.toolbar,
      h('div', { class: 'box', style: { padding: '8px 16px' } }, this.list),
      this.more,
    );
    this.renderToolbar();
    document.addEventListener('keydown', this.onKey);
    void api
      .prefs()
      .then((p) => {
        this.watchlist = p.watchlist.filter((w) => w.enabled);
        this.renderToolbar();
      })
      .catch(() => undefined);
    void this.reset().then(() => {
      this.observe();
      if (params['id'] !== undefined) this.open(params['id'].toUpperCase(), null);
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
    closeCveDrawer();
  }

  private queryString(): string {
    const qs = new URLSearchParams();
    if (this.filters.size > 0) qs.set('filter', [...this.filters].join(','));
    if (this.tech !== null) qs.set('tech', this.tech);
    if (this.sort !== 'priority') qs.set('sort', this.sort);
    if (this.view === 'cards') qs.set('view', 'cards');
    const text = qs.toString();
    return text === '' ? '' : `?${text}`;
  }

  private update(): void {
    window.history.replaceState(null, '', `/threats${this.queryString()}`);
    this.renderToolbar();
    void this.reset();
  }

  private renderToolbar(): void {
    const chip = (label: string, pressed: boolean, onClick: () => void) =>
      h('button', {
        class: 'chip',
        attrs: { type: 'button', 'aria-pressed': String(pressed) },
        text: label,
        on: { click: onClick },
      });
    const toggle = (filter: CveFilter) => () => {
      if (this.filters.has(filter)) this.filters.delete(filter);
      else this.filters.add(filter);
      this.update();
    };
    const sortLabels: Record<CveSort, MessageKey> = {
      priority: 'threats.sortPriority',
      newest: 'threats.sortNewest',
      cvss: 'threats.sortCvss',
      epss: 'threats.sortEpss',
    };
    mount(
      this.toolbar,
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'chips', attrs: { role: 'group', 'aria-label': t('threats.filters') } },
          chip(t('threats.all'), this.filters.size === 0 && this.tech === null, () => {
            this.filters.clear();
            this.tech = null;
            this.update();
          }),
          chip(t('threats.kev'), this.filters.has('kev'), toggle('kev')),
          chip(t('threats.watchlist'), this.filters.has('watchlist'), toggle('watchlist')),
          chip(t('threats.critical'), this.filters.has('critical'), toggle('critical')),
          chip(t('threats.high'), this.filters.has('high'), toggle('high')),
          this.watchlist.map((w) =>
            chip(w.label, this.tech === w.id, () => {
              this.tech = this.tech === w.id ? null : w.id;
              this.update();
            }),
          ),
        ),
        h(
          'div',
          { class: 'toolbar__group' },
          h(
            'div',
            { class: 'pn-seg', attrs: { role: 'group', 'aria-label': t('threats.sort') } },
            CVE_SORTS.map((s) =>
              h('button', {
                attrs: { type: 'button', 'aria-pressed': String(this.sort === s) },
                text: t(sortLabels[s]),
                on: {
                  click: () => {
                    this.sort = s;
                    this.update();
                  },
                },
              }),
            ),
          ),
          h(
            'div',
            { class: 'pn-seg', attrs: { role: 'group', 'aria-label': t('threats.view') } },
            (['compact', 'cards'] as const).map((v) =>
              h('button', {
                attrs: { type: 'button', 'aria-pressed': String(this.view === v) },
                text: t(v === 'compact' ? 'threats.compact' : 'threats.cards'),
                on: {
                  click: () => {
                    this.view = v;
                    this.list.className = v === 'cards' ? 'cards' : 'cve-list';
                    window.history.replaceState(null, '', `/threats${this.queryString()}`);
                    this.renderToolbar();
                  },
                },
              }),
            ),
          ),
        ),
      ),
    );
    this.list.className = this.view === 'cards' ? 'cards' : 'cve-list';
  }

  protected fetchPage(cursor: string | null): Promise<Page<CveSummaryDto>> {
    return api.cves({
      filter: this.filters.size > 0 ? [...this.filters].join(',') : undefined,
      tech: this.tech ?? undefined,
      sort: this.sort,
      limit: PAGE_SIZE,
      cursor: cursor ?? undefined,
    });
  }

  protected renderItem(cve: CveSummaryDto): HTMLElement {
    return cveRow(cve, lang.get(), (c, opener) => {
      this.open(c.cveId, opener);
    });
  }

  protected emptyText(): string {
    return t('threats.empty');
  }

  private open(cveId: string, opener: HTMLElement | null): void {
    const ids = this.items.map((c) => c.cveId);
    this.drawerOpen = true;
    openCveDrawer(cveId, {
      list: ids.includes(cveId) ? ids : [cveId],
      opener,
      // The deep link /threats/CVE-… is what the bots send (SPEC § 4.3 C).
      onShow: (id) => {
        window.history.replaceState(null, '', `/threats/${id}${this.queryString()}`);
      },
      onClose: () => {
        this.drawerOpen = false;
        window.history.replaceState(null, '', `/threats${this.queryString()}`);
      },
    });
  }
}

/** `/breaches`: HIBP breaches with the mandatory attribution (SPEC § 6.1). */
export class PnBreachesPage extends PagedList<BreachDto> {
  connectedCallback(): void {
    mount(
      this,
      h('h1', {
        class: 'page-title',
        attrs: { id: 'page-title', tabindex: -1 },
        text: t('page.breaches'),
      }),
      h('div', { class: 'box', style: { padding: '8px 22px' } }, this.list),
      this.more,
      h(
        'p',
        { class: 'page-footer' },
        externalLink('https://haveibeenpwned.com/', t('breaches.license'), {
          label: t('breaches.attribution'),
        }),
      ),
    );
    void this.reset().then(() => {
      this.observe();
    });
  }

  protected fetchPage(cursor: string | null): Promise<Page<BreachDto>> {
    return api.breaches(cursor ?? undefined);
  }

  protected renderItem(b: BreachDto): HTMLElement {
    return h(
      'article',
      { class: 'list-item' },
      h(
        'div',
        null,
        h('h2', { class: 'list-item__title', text: b.title }),
        h(
          'p',
          { class: 'meta' },
          b.domain === '' ? null : h('span', { class: 'mono', text: b.domain }),
          h('span', { text: t('breaches.breachDate', { date: formatDate(b.breachDate) }) }),
          h('span', { text: t('breaches.added', { date: formatDate(b.addedDate) }) }),
          h('span', {
            class: 'badge',
            data: { sev: b.isVerified ? 'none' : 'medium' },
            text: t(b.isVerified ? 'breaches.verified' : 'breaches.unverified'),
          }),
          b.isSensitive
            ? h('span', { class: 'badge', data: { sev: 'high' }, text: t('breaches.sensitive') })
            : null,
        ),
        h(
          'div',
          { class: 'data-classes' },
          b.dataClasses.slice(0, 8).map((c) => h('span', { class: 'badge', text: c })),
        ),
      ),
      h('p', {
        class: 'kpi__value',
        style: { 'font-size': '28px' },
        text: t('brief.accounts', { n: formatCompact(b.accounts) }),
      }),
    );
  }

  protected emptyText(): string {
    return t('breaches.empty');
  }
}

/** `/releases`: tracked software versions, security releases flagged. */
export class PnReleasesPage extends PagedList<ReleaseDto> {
  connectedCallback(): void {
    mount(
      this,
      h('h1', {
        class: 'page-title',
        attrs: { id: 'page-title', tabindex: -1 },
        text: t('page.releases'),
      }),
      h('div', { class: 'box', style: { padding: '8px 22px' } }, this.list),
      this.more,
    );
    void this.reset().then(() => {
      this.observe();
    });
  }

  protected fetchPage(cursor: string | null): Promise<Page<ReleaseDto>> {
    return api.releases(cursor ?? undefined);
  }

  protected renderItem(r: ReleaseDto): HTMLElement {
    return h(
      'article',
      { class: 'list-item' },
      h(
        'div',
        null,
        h(
          'h2',
          { class: 'list-item__title' },
          `${r.product} `,
          h('span', { class: 'mono', text: r.version }),
        ),
        h(
          'p',
          { class: 'meta' },
          h('time', { attrs: { datetime: r.publishedAt }, text: formatDate(r.publishedAt) }),
          r.isSecurity
            ? h('span', { class: 'badge', data: { sev: 'critical' }, text: t('releases.security') })
            : null,
        ),
      ),
      externalLink(r.url, `${t('releases.notes')} ↗`, {
        class: 'link-accent',
        label: `${r.product} ${r.version}`,
      }),
    );
  }

  protected emptyText(): string {
    return t('releases.empty');
  }
}
