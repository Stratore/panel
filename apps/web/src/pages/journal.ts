import { CATEGORIES, type Category, type ItemDto, type JournalDto } from '@panel/shared';
import { POLL_EVENT, STREAM_EVENT } from '../app-context.js';
import { emptyState, skeleton } from '../components/states.js';
import {
  categoryName,
  cveTitle,
  externalLink,
  itemMeta,
  percent,
  severityOf,
} from '../components/ui.js';
import { api } from '../lib/api.js';
import { loadView } from '../lib/data.js';
import { h, mount, svg } from '../lib/h.js';
import { formatDate, formatNumber, lang, t } from '../lib/i18n.js';
import { every } from '../lib/motion.js';
import type { StreamEvent } from '../lib/sse.js';

type Filter = Category | 'all';

const FRONT_MS = 9_000;
const SECTION_MS = 4_500;
const WIRE_MAX = 40;

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** 8×8 generative dot grid, reshaped by the story on display (formula from the mockup). */
function dotGrid(): { svg: SVGElement; update: (seed: string) => void } {
  const circles: SVGElement[] = [];
  const root = svg('svg', { viewBox: '0 0 220 220', 'aria-hidden': 'true' });
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const circle = svg('circle', {
        cx: (18 + x * 26.3).toFixed(1),
        cy: (18 + y * 26.3).toFixed(1),
        r: 3,
      });
      circles.push(circle);
      root.append(circle);
    }
  }
  const update = (seed: string) => {
    const hi = (hashOf(seed) % 700) / 100;
    circles.forEach((circle, index) => {
      const x = index % 8;
      const y = Math.floor(index / 8);
      const v = Math.sin((x + 1) * (hi + 1.3) * 0.7) * Math.cos((y + 1) * (hi + 0.6) * 0.55);
      const a = (v + 1) / 2;
      circle.setAttribute('r', (3 + a * 8).toFixed(1));
      circle.setAttribute('opacity', (0.25 + a * 0.75).toFixed(2));
    });
  };
  return { svg: root, update };
}

/** A set of slides with dots, rotating on its own clock (front page and section boxes). */
function rotator(options: {
  items: ItemDto[];
  label: string;
  slide: (item: ItemDto) => HTMLElement;
  onChange?: (item: ItemDto, index: number) => void;
}) {
  let index = 0;
  const slides = options.items.map((item, i) => {
    const el = options.slide(item);
    el.classList.add('slide');
    el.setAttribute('aria-hidden', String(i !== 0));
    if (i !== 0) el.setAttribute('inert', '');
    return el;
  });
  const dots = options.items.map((item, i) =>
    h('button', {
      attrs: {
        type: 'button',
        'aria-label': t('journal.story', { n: i + 1, total: options.items.length }),
        'aria-current': String(i === 0),
      },
      on: {
        click: () => {
          show(i);
        },
      },
    }),
  );
  const position = h('span', {
    class: 'mono',
    text: options.items.length > 0 ? `1/${String(options.items.length)}` : '',
  });
  const show = (next: number) => {
    index = (next + options.items.length) % options.items.length;
    slides.forEach((slide, i) => {
      slide.setAttribute('aria-hidden', String(i !== index));
      slide.toggleAttribute('inert', i !== index);
    });
    dots.forEach((dot, i) => {
      dot.setAttribute('aria-current', String(i === index));
    });
    position.textContent = `${String(index + 1)}/${String(options.items.length)}`;
    const item = options.items[index];
    if (item) options.onChange?.(item, index);
  };
  return {
    slides,
    dots: h('div', { class: 'dots', attrs: { role: 'group', 'aria-label': options.label } }, dots),
    position,
    next: () => {
      show(index + 1);
    },
  };
}

/** Stream payloads are untyped JSON: only strings are used as text. */
const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const wireTime = (iso: string) =>
  formatDate(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function wireRow(
  item: Pick<ItemDto, 'url' | 'title' | 'category' | 'publishedAt'>,
  fresh = false,
): HTMLElement {
  return externalLink(
    item.url,
    [
      h('time', {
        class: 'wire__time',
        attrs: { datetime: item.publishedAt },
        text: wireTime(item.publishedAt),
      }),
      h(
        'span',
        { style: { display: 'grid', gap: '4px' } },
        h('span', { class: 'cat-label', text: categoryName(item.category) }),
        h('span', { class: 'wire__text', text: item.title }),
      ),
    ],
    { class: fresh ? 'wire__row wire__row--new' : 'wire__row' },
  );
}

export class PnJournalPage extends HTMLElement {
  private data: JournalDto | null = null;
  private filter: Filter = 'all';
  private stops: (() => void)[] = [];
  private wireTrack: HTMLElement | null = null;
  private wireCount: HTMLElement | null = null;
  private liveItems: Pick<ItemDto, 'url' | 'title' | 'category' | 'publishedAt'>[] = [];

  private readonly onStream = (event: Event) => {
    const { type, payload } = (event as CustomEvent<StreamEvent>).detail;
    if (type !== 'item.new' || payload['kind'] !== 'article') return;
    const item = {
      url: text(payload['url'], ''),
      title: text(payload['title'], ''),
      category: (CATEGORIES as readonly string[]).includes(text(payload['category'], ''))
        ? (payload['category'] as Category)
        : 'dev',
      publishedAt: text(payload['publishedAt'], new Date().toISOString()),
    };
    this.liveItems.unshift(item);
    if (this.filter !== 'all' && item.category !== this.filter) return;
    // New items slide in at the top without moving the layout (SPEC § 10).
    this.wireTrack?.prepend(wireRow(item, true));
    this.wireTrack?.lastElementChild?.remove();
  };

  private readonly onPoll = () => {
    void this.load();
  };

  connectedCallback(): void {
    mount(
      this,
      h(
        'div',
        { class: 'bento', style: { 'margin-top': '40px' } },
        h('div', { class: 'box s8' }, skeleton({ height: '28px', lines: 5 })),
        h('div', { class: 'box s4' }, skeleton({ lines: 8 })),
      ),
    );
    document.addEventListener(STREAM_EVENT, this.onStream);
    document.addEventListener(POLL_EVENT, this.onPoll);
    void this.load();
  }

  disconnectedCallback(): void {
    this.stopClocks();
    document.removeEventListener(STREAM_EVENT, this.onStream);
    document.removeEventListener(POLL_EVENT, this.onPoll);
    document.getElementById('top-band')?.replaceChildren();
  }

  private async load(): Promise<void> {
    try {
      await loadView(
        'journal',
        (signal?: AbortSignal) => api.journal(signal),
        ({ value }) => {
          this.data = value;
          this.liveItems = [];
          this.render();
        },
      );
    } catch {
      mount(
        this,
        h('div', { class: 'box', style: { 'margin-top': '40px' } }, emptyState(t('state.error'))),
      );
    }
  }

  private stopClocks(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  private render(): void {
    const data = this.data;
    if (!data) return;
    this.stopClocks();
    const now = new Date();
    document.getElementById('top-band')?.replaceChildren(this.ticker(data));

    const hasStories = data.front.length > 0 || data.wire.length > 0;
    mount(
      this,
      this.masthead(data, now),
      this.filters(),
      hasStories
        ? h(
            'div',
            { class: 'bento' },
            data.front.length > 0 ? this.front(data.front, now) : null,
            this.wire(data, now),
            CATEGORIES.filter((c) => this.filter === 'all' || c === this.filter).map((c, i) =>
              this.section(c, data.sections[c], i, now),
            ),
            this.sixty(data),
            this.snapshot(data),
          )
        : h('div', { class: 'box' }, emptyState(t('journal.empty'))),
      h(
        'footer',
        { class: 'page-footer' },
        h('span', { text: t('journal.footer') }),
        h(
          'span',
          null,
          t('journal.footerSources'),
          ' · ',
          externalLink('https://haveibeenpwned.com/', t('breaches.attribution'), {
            label: t('breaches.attribution'),
          }),
        ),
      ),
    );
  }

  private ticker(data: JournalDto): HTMLElement {
    const items = data.ticker.length > 0 ? data.ticker : data.wire.slice(0, 10);
    const entry = (item: ItemDto) =>
      externalLink(
        item.url,
        [h('span', { class: 'cat-label', text: categoryName(item.category) }), item.title],
        { class: 'ticker__item' },
      );
    const copy = (hidden: boolean) => {
      const group = h(
        'div',
        { style: { display: 'flex' } },
        items.map((item) => entry(item)),
      );
      if (hidden) {
        group.setAttribute('aria-hidden', 'true');
        group.setAttribute('inert', '');
      }
      return group;
    };
    const band = h(
      'div',
      { class: 'ticker', attrs: { role: 'region', 'aria-label': t('journal.liveHeadlines') } },
      h(
        'div',
        { class: 'ticker__label' },
        h('span', { class: 'live-dot', attrs: { 'aria-hidden': 'true' } }),
        t('journal.live'),
      ),
      h(
        'div',
        { class: 'ticker__viewport' },
        h('div', { class: 'ticker__track' }, copy(false), copy(true)),
      ),
    );
    band.querySelectorAll<HTMLElement>('.ticker__item').forEach((el, i) => {
      const item = items[i % Math.max(1, items.length)];
      if (item) el.dataset['cat'] = item.category;
    });
    return band;
  }

  private masthead(data: JournalDto, now: Date): HTMLElement {
    const start = Date.UTC(now.getUTCFullYear(), 0, 0);
    const edition = Math.floor((now.getTime() - start) / 86_400_000);
    return h(
      'section',
      { class: 'masthead' },
      h(
        'div',
        { class: 'masthead__side' },
        formatDate(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        h('br'),
        t('journal.edition', { n: edition }),
      ),
      h('h1', {
        class: 'masthead__title',
        attrs: { id: 'page-title', tabindex: -1 },
        text: t('page.journal'),
      }),
      h(
        'div',
        { class: 'masthead__side masthead__right' },
        data.lastUpdated ? t('journal.updated', { time: wireTime(data.lastUpdated) }) : null,
        h(
          'button',
          {
            class: 'pn-iconbtn',
            attrs: { type: 'button', 'aria-keyshortcuts': 'Control+K Meta+K /' },
            on: { click: () => document.dispatchEvent(new CustomEvent('pn:palette')) },
          },
          h('span', { class: 'kbd', text: '⌘K' }),
          t('header.search'),
        ),
      ),
    );
  }

  private filters(): HTMLElement {
    const options: Filter[] = ['all', ...CATEGORIES];
    return h(
      'div',
      {
        class: 'chips',
        attrs: { role: 'group', 'aria-label': t('journal.filter') },
        style: { 'margin-bottom': '24px' },
      },
      options.map((option) => {
        const chip = h(
          'button',
          {
            class: 'chip',
            attrs: { type: 'button', 'aria-pressed': String(this.filter === option) },
            on: {
              click: () => {
                this.filter = option;
                this.render();
              },
            },
          },
          h('span', { class: 'dot-c', attrs: { 'aria-hidden': 'true' } }),
          option === 'all' ? t('cat.all') : categoryName(option),
        );
        if (option !== 'all') chip.dataset['cat'] = option;
        return chip;
      }),
    );
  }

  private front(items: ItemDto[], now: Date): HTMLElement {
    const grid = dotGrid();
    const box = h('article', {
      class: 'box box--hover front s8 d1',
      attrs: { 'aria-label': t('journal.frontPage') },
    });
    const setCategory = (item: ItemDto) => {
      box.dataset['cat'] = item.category;
      grid.update(item.title);
    };
    const r = rotator({
      items,
      label: t('journal.frontStories'),
      onChange: setCategory,
      slide: (item) => {
        const slide = h(
          'div',
          { class: 'front__slide', data: { cat: item.category } },
          h('span', {
            class: 'front__eyebrow',
            text: `${t('journal.frontPage')} · ${categoryName(item.category)}`,
          }),
          externalLink(item.url, h('span', { class: 'hl', text: item.title }), {
            class: 'front__title',
          }),
          item.summary === ''
            ? null
            : h('p', { class: 'front__stand', attrs: { lang: item.lang }, text: item.summary }),
          itemMeta(item, now),
        );
        return slide;
      },
    });
    const first = items[0];
    if (first) setCategory(first);
    box.append(
      h('div', { class: 'front__text' }, r.slides),
      h(
        'div',
        { class: 'front__visual' },
        grid.svg,
        h('div', { class: 'front__controls' }, r.dots, r.position),
      ),
    );
    if (items.length > 1) this.stops.push(every(FRONT_MS, r.next));
    return box;
  }

  private wire(data: JournalDto, now: Date): HTMLElement {
    const items = [...this.liveItems, ...data.wire]
      .filter((i) => this.filter === 'all' || i.category === this.filter)
      .slice(0, WIRE_MAX);
    const today = data.wire.filter(
      (i) => now.getTime() - Date.parse(i.publishedAt) < 86_400_000,
    ).length;
    this.wireCount = h('span', {
      class: 'sub',
      style: { 'font-size': '12.5px' },
      text: t('journal.wireCount', { n: today }),
    });
    const rows = items.map((item) => wireRow(item));
    // The list is doubled so the vertical loop is seamless; the copy is hidden from AT.
    const copy = h(
      'div',
      { attrs: { 'aria-hidden': 'true', inert: true } },
      items.map((item) => wireRow(item)),
    );
    this.wireTrack = h('div', null, rows);
    return h(
      'section',
      { class: 'box wire s4 r2 d2', attrs: { 'aria-labelledby': 'wire-title' } },
      h(
        'div',
        { class: 'wire__head' },
        h(
          'h2',
          { class: 'wire__title', attrs: { id: 'wire-title' } },
          h('span', { class: 'live-dot', attrs: { 'aria-hidden': 'true' } }),
          t('journal.wire'),
        ),
        this.wireCount,
      ),
      h(
        'div',
        {
          class: 'wire__viewport',
          // A labelled, focusable region (scrollable from the keyboard). Not role="feed": the
          // rows are links inside wrappers for the seamless loop, not direct article children.
          attrs: { tabindex: 0, role: 'region', 'aria-label': t('journal.wire') },
        },
        h('div', { class: 'wire__track' }, this.wireTrack, items.length > 6 ? copy : null),
      ),
    );
  }

  private section(category: Category, items: ItemDto[], index: number, now: Date): HTMLElement {
    const box = h('section', {
      class: `box box--hover section s4 d${String(Math.min(6, index + 3))}`,
      data: { cat: category },
      attrs: { 'aria-labelledby': `sec-${category}` },
    });
    const head = h(
      'div',
      { class: 'box__head', style: { 'margin-bottom': '0' } },
      h('h2', {
        class: 'section__title',
        attrs: { id: `sec-${category}` },
        text: categoryName(category),
      }),
    );
    if (items.length === 0) {
      box.append(head, emptyState(t('state.empty')));
      return box;
    }
    const r = rotator({
      items,
      label: t('journal.sectionStories', { name: categoryName(category) }),
      slide: (item) =>
        externalLink(
          item.url,
          [
            h(
              'span',
              { class: 'section__headline' },
              h('span', { class: 'hl', attrs: { lang: item.lang }, text: item.title }),
            ),
            itemMeta(item, now),
          ],
          { class: 'section__slide' },
        ),
    });
    head.append(r.position);
    box.append(head, h('div', { class: 'section__slides' }, r.slides), r.dots);
    // Staggered rotation (SPEC § 4.2): each box starts 900 ms after the previous one.
    if (items.length > 1) this.stops.push(every(SECTION_MS, r.next, index * 900));
    return box;
  }

  private sixty(data: JournalDto): HTMLElement {
    const code = lang.get();
    return h(
      'section',
      { class: 'box box--inv sixty s6 d5', attrs: { 'aria-labelledby': 'sixty-title' } },
      h('h2', { class: 'sixty__title', attrs: { id: 'sixty-title' }, text: t('journal.sixty') }),
      h(
        'ol',
        null,
        data.sixty.map((entry, i) => {
          const text = entry.text[code];
          const body =
            entry.href === null
              ? h('span', { text })
              : entry.href.startsWith('/')
                ? h('a', { attrs: { href: entry.href }, text })
                : externalLink(entry.href, text);
          return h(
            'li',
            { data: { cat: entry.category } },
            h('span', { class: 'sixty__n', text: String(i + 1).padStart(2, '0') }),
            h(
              'span',
              null,
              h('span', { class: 'cat-label', text: categoryName(entry.category) }),
              body,
            ),
          );
        }),
      ),
    );
  }

  private snapshot(data: JournalDto): HTMLElement {
    const s = data.snapshot;
    const tile = (value: number, label: string, color: string) =>
      h(
        'div',
        { class: 'snap-tile' },
        h('span', { class: 'snap-tile__value', text: formatNumber(value) }),
        h(
          'span',
          { class: 'snap-tile__label' },
          h('span', { class: 'dot-c', style: { '--c': color } }),
          label,
        ),
      );
    const code = lang.get();
    return h(
      'section',
      { class: 'box snapshot s6 d6', attrs: { 'aria-labelledby': 'snap-title' } },
      h(
        'div',
        { class: 'box__head', style: { 'margin-bottom': '0' } },
        h('h2', { class: 'box__title', attrs: { id: 'snap-title' }, text: t('journal.snapshot') }),
        h('a', { class: 'link-accent', attrs: { href: '/brief' }, text: t('journal.openBrief') }),
      ),
      h(
        'div',
        { class: 'snap-grid' },
        tile(s.newCves24h, t('journal.snapNew'), 'var(--accent)'),
        tile(s.critical24h, t('journal.snapCritical'), 'var(--sev-critical)'),
        tile(s.kevNew7d, t('journal.snapKev'), 'var(--sev-high)'),
        tile(s.watchlist7d, t('journal.snapWatchlist'), 'var(--cat-ai)'),
      ),
      s.top.map((cve) =>
        h(
          'a',
          { class: 'snap-row', attrs: { href: `/threats/${cve.cveId}` } },
          h(
            'span',
            { style: { display: 'grid', gap: '3px' } },
            h('span', {
              class: 'mono sub',
              style: { 'font-size': '12px' },
              text: cve.kev ? `${cve.cveId} · KEV` : cve.cveId,
            }),
            h('span', {
              style: { 'font-size': '15px', 'font-weight': '600' },
              text: cveTitle(cve, code),
            }),
          ),
          h('span', {
            class: 'badge badge--mono',
            data: { sev: severityOf(cve) },
            text:
              cve.epss === null
                ? String(cve.cvssEffective)
                : `${String(cve.cvssEffective)} · ${percent(cve.epss)}`,
          }),
        ),
      ),
    );
  }
}
