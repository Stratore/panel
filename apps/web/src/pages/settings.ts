import {
  CATEGORIES,
  type ExportDto,
  type Lang,
  type Prefs,
  type PrefsDto,
  type SourceDto,
  type SourceValidation,
  type WatchlistEntry,
} from '@panel/shared';
import { logout, router, savePrefs } from '../app-context.js';
import { emptyState, skeleton } from '../components/states.js';
import { categoryName, checkIcon, sectionHead, switchButton } from '../components/ui.js';
import { api, ApiError } from '../lib/api.js';
import { clearCache } from '../lib/cache.js';
import { h, mount } from '../lib/h.js';
import { formatCompact, formatNumber, t, type MessageKey } from '../lib/i18n.js';
import { isDemo, prefs } from '../lib/state.js';
import { toast } from '../lib/toast.js';

const TABS = ['sources', 'watchlist', 'alerts', 'display', 'data'] as const;
type Tab = (typeof TABS)[number];

const GROUPS: readonly { id: string; label: MessageKey }[] = [
  { id: 'security', label: 'settings.groupSecurity' },
  { id: 'tech', label: 'settings.groupTech' },
  { id: 'releases', label: 'settings.groupReleases' },
  { id: 'custom', label: 'settings.groupCustom' },
];

function healthLabel(source: SourceDto): { key: string; text: string } {
  if (!source.enabled) return { key: 'paused', text: t('health.paused') };
  if (source.health === 'slow') {
    const seconds = formatNumber((source.lastRun?.durationMs ?? 0) / 1000, {
      maximumFractionDigits: 1,
    });
    return { key: 'slow', text: t('health.slow', { s: seconds }) };
  }
  return { key: source.health, text: t(`health.${source.health}` as MessageKey) };
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, ms);
  };
}

/** `/settings/:tab` (SPEC § 4.3 D). */
export class PnSettingsPage extends HTMLElement {
  private tab: Tab = 'sources';
  private sources: SourceDto[] = [];
  private config: PrefsDto | null = null;
  private readonly panel = h('div', {
    attrs: { role: 'tabpanel', id: 'settings-panel', tabindex: 0 },
  });

  connectedCallback(): void {
    const requested = router.route.get().params['tab'];
    this.tab = (TABS as readonly string[]).includes(requested ?? '')
      ? (requested as Tab)
      : 'sources';
    mount(this.panel, skeleton({ lines: 8 }));
    this.renderShell();
    void Promise.all([api.sources(), api.prefs()])
      .then(([sources, config]) => {
        this.sources = sources;
        this.config = config;
        this.renderPanel();
      })
      .catch(() => {
        mount(this.panel, h('div', { class: 'box' }, emptyState(t('state.error'))));
      });
  }

  private renderShell(): void {
    const labels: Record<Tab, MessageKey> = {
      sources: 'settings.sources',
      watchlist: 'settings.watchlist',
      alerts: 'settings.alerts',
      display: 'settings.display',
      data: 'settings.data',
    };
    const tabButtons = TABS.map((tab) =>
      h('button', {
        attrs: {
          type: 'button',
          role: 'tab',
          id: `tab-${tab}`,
          'aria-selected': String(this.tab === tab),
          'aria-controls': 'settings-panel',
          tabindex: this.tab === tab ? 0 : -1,
        },
        text: t(labels[tab]),
        on: {
          click: () => {
            this.select(tab);
          },
          keydown: (event) => {
            // Arrow keys move between tabs (WAI-ARIA tabs pattern).
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const i = TABS.indexOf(tab);
            const next =
              TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length] ??
              'sources';
            this.select(next);
            this.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
          },
        },
      }),
    );
    this.panel.setAttribute('aria-labelledby', `tab-${this.tab}`);
    mount(
      this,
      h(
        'div',
        { class: 'settings-head' },
        h('h1', {
          class: 'page-title',
          attrs: { id: 'page-title', tabindex: -1 },
          text: t('page.settings'),
        }),
        h(
          'div',
          { class: 'tabs', attrs: { role: 'tablist', 'aria-label': t('settings.tabs') } },
          tabButtons,
        ),
      ),
      this.panel,
    );
  }

  private select(tab: Tab): void {
    this.tab = tab;
    window.history.replaceState(null, '', `/settings/${tab}`);
    this.renderShell();
    this.renderPanel();
  }

  private renderPanel(): void {
    if (!this.config) return;
    const views: Record<Tab, () => HTMLElement> = {
      sources: () => h('div', { class: 'bento' }, this.sourcesBox(), this.addSourceBox()),
      watchlist: () => h('div', { class: 'bento' }, this.watchlistBox()),
      alerts: () => h('div', { class: 'bento' }, this.alertsBox()),
      display: () => h('div', { class: 'bento' }, this.displayBox()),
      data: () => h('div', { class: 'bento' }, this.dataBox()),
    };
    mount(this.panel, views[this.tab]());
  }

  // --- Sources -----------------------------------------------------------------------------

  private sourcesBox(): HTMLElement {
    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'src-title' } },
      sectionHead(t('settings.sources'), 'src-title'),
      GROUPS.map((group) => {
        const rows = this.sources.filter((s) => s.group === group.id);
        if (rows.length === 0) return null;
        return h(
          'div',
          { class: 'src-group' },
          h('h3', { class: 'eyebrow', text: t(group.label) }),
          rows.map((s) => this.sourceRow(s)),
        );
      }),
    );
  }

  private sourceRow(source: SourceDto): HTMLElement {
    const health = healthLabel(source);
    let host = source.url;
    try {
      host = new URL(source.url).host;
    } catch {
      // Keep the raw value.
    }
    const status = h(
      'span',
      {
        class: 'health',
        data: { health: health.key },
        attrs: source.lastRun?.error ? { title: source.lastRun.error } : {},
      },
      h('span', { class: 'dot-c', attrs: { 'aria-hidden': 'true' } }),
      health.text,
    );
    const toggle = switchButton({
      checked: source.enabled,
      label: t('settings.enable', { name: source.name }),
      onChange: (enabled) => {
        void api
          .updateSource(source.id, { enabled })
          .then((updated) => {
            this.sources = this.sources.map((s) => (s.id === updated.id ? updated : s));
            const next = healthLabel(updated);
            status.dataset['health'] = next.key;
            status.lastChild?.replaceWith(next.text);
          })
          .catch(() => {
            toast(t('state.error'));
          });
      },
    });
    return h(
      'div',
      { class: 'src-row' },
      h(
        'div',
        { style: { 'min-width': '0' } },
        h(
          'div',
          { class: 'src-row__name' },
          source.name,
          h('span', {
            class: 'badge badge--mono',
            text: source.adapter === 'rss' ? 'RSS' : source.kind === 'cve' ? 'API' : 'JSON',
          }),
          h('span', { class: 'lang-tag', text: source.lang.toUpperCase() }),
          source.isCustom
            ? h('span', {
                class: 'sub',
                style: { 'font-size': '12.5px', 'font-weight': '400' },
                text: t('settings.addedByYou'),
              })
            : null,
        ),
        h('div', { class: 'src-row__url mono', text: host }),
        source.lastRun?.error
          ? h('div', {
              class: 'form-error',
              style: { 'min-height': '0', 'font-size': '12.5px' },
              text: source.lastRun.error,
            })
          : null,
      ),
      status,
      h(
        'div',
        { style: { display: 'flex', 'align-items': 'center' } },
        toggle,
        source.isCustom
          ? h('button', {
              class: 'pn-iconbtn',
              attrs: { type: 'button', 'aria-label': t('settings.delete', { name: source.name }) },
              text: '✕',
              on: {
                click: () => {
                  void api.deleteSource(source.id).then(() => {
                    this.sources = this.sources.filter((s) => s.id !== source.id);
                    toast(t('settings.deleted'));
                    this.renderPanel();
                  });
                },
              },
            })
          : null,
      ),
    );
  }

  private addSourceBox(): HTMLElement {
    let validated: SourceValidation | null = null;
    const url = h('input', {
      class: 'input mono',
      attrs: {
        id: 'feed-url',
        type: 'url',
        inputmode: 'url',
        placeholder: 'https://…',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    });
    const test = h('button', {
      class: 'btn btn--ghost',
      attrs: { type: 'button' },
      text: t('settings.testFeed'),
    });
    const name = h('input', { class: 'input', attrs: { id: 'feed-name', maxlength: 60 } });
    const language = h(
      'select',
      { class: 'input', attrs: { id: 'feed-lang' } },
      (['en', 'fr'] as const).map((code) =>
        h('option', { attrs: { value: code }, text: t(`lang.${code}`) }),
      ),
    );
    const category = h(
      'select',
      { class: 'input', attrs: { id: 'feed-cat' } },
      CATEGORIES.map((c) => h('option', { attrs: { value: c }, text: categoryName(c) })),
    );
    const add = h('button', {
      class: 'btn',
      attrs: { type: 'submit', disabled: true },
      text: t('settings.addSource'),
    });
    const checks = h('ul', { class: 'checks', attrs: { 'aria-live': 'polite' } });
    const preview = h('div', { attrs: { 'aria-live': 'polite' } });

    url.addEventListener('input', () => {
      // A new URL must be tested again before it can be added.
      validated = null;
      add.disabled = true;
    });

    test.addEventListener('click', () => {
      if (url.value.trim() === '') {
        url.focus();
        return;
      }
      test.disabled = true;
      test.textContent = t('settings.testing');
      mount(checks, skeleton({ lines: 4 }));
      preview.replaceChildren();
      api
        .validateSource(url.value.trim())
        .then((result) => {
          validated = result.ok ? result : null;
          add.disabled = !result.ok;
          mount(
            checks,
            result.checks.map((check) => {
              const ran = check.detail !== 'Not checked';
              return h(
                'li',
                { data: { ok: ran ? String(check.ok) : 'skip' } },
                ran
                  ? checkIcon(check.ok)
                  : h('span', { attrs: { 'aria-hidden': 'true' }, text: '·' }),
                h(
                  'span',
                  null,
                  h('strong', { text: t(`check.${check.id}` as MessageKey) }),
                  ran
                    ? h('span', { class: 'sub', text: ` · ${check.detail}` })
                    : h('span', { class: 'sub', text: ` · ${t('check.notRun')}` }),
                ),
              );
            }),
          );
          if (result.preview.length > 0) {
            mount(
              preview,
              h('h3', { class: 'section-label', text: t('settings.preview') }),
              h(
                'ul',
                { class: 'mini-list' },
                result.preview.map((p) =>
                  h(
                    'li',
                    null,
                    h('span', {
                      class: 'mini-list__title',
                      style: { padding: '8px 0', display: 'block' },
                      text: p.title,
                    }),
                  ),
                ),
              ),
            );
            if (name.value === '') {
              try {
                name.value = new URL(result.url).hostname.replace(/^www\./, '');
              } catch {
                // Leave empty.
              }
            }
          }
        })
        .catch(() => {
          mount(checks, h('li', { data: { ok: 'false' } }, checkIcon(false), t('state.error')));
        })
        .finally(() => {
          test.disabled = false;
          test.textContent = t('settings.testFeed');
        });
    });

    const form = h(
      'form',
      {
        attrs: { novalidate: true },
        on: {
          submit: (event) => {
            event.preventDefault();
            if (!validated) {
              toast(t('settings.testFirst'));
              return;
            }
            add.disabled = true;
            api
              .createSource({
                name: name.value.trim() || new URL(validated.url).hostname,
                url: validated.url,
                lang: language.value as Lang,
                category: category.value,
              })
              .then((created) => {
                this.sources = [...this.sources, created];
                toast(t('settings.added'));
                this.renderPanel();
              })
              .catch((error: unknown) => {
                toast(error instanceof ApiError ? error.message : t('state.error'));
                add.disabled = false;
              });
          },
        },
      },
      h(
        'div',
        { class: 'field' },
        h('label', { attrs: { for: 'feed-url' }, text: t('settings.feedUrl') }),
        h('div', { class: 'url-row' }, url, test),
      ),
      h('div', { class: 'add-grid' }, checks, preview),
      h(
        'div',
        { class: 'form-row', style: { 'margin-top': '18px' } },
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: 'feed-name' }, text: t('settings.sourceName') }),
          name,
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: 'feed-lang' }, text: t('settings.sourceLang') }),
          language,
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: 'feed-cat' }, text: t('settings.sourceCategory') }),
          category,
        ),
      ),
      h('div', { style: { 'margin-top': '18px' } }, add),
    );
    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'add-title' } },
      sectionHead(t('settings.addTitle'), 'add-title'),
      form,
    );
  }

  // --- Watchlist ---------------------------------------------------------------------------

  private watchlistBox(): HTMLElement {
    const config = this.config;
    if (!config) return h('div');
    const save = (watchlist: WatchlistEntry[]) => {
      void api
        .savePrefs({ watchlist })
        .then((saved) => {
          this.config = saved;
          toast(t('toast.saved'));
          this.renderPanel();
        })
        .catch(() => {
          toast(t('state.error'));
        });
    };
    const label = h('input', {
      class: 'input',
      attrs: { id: 'tech-name', maxlength: 40, required: true },
    });
    const keywords = h('input', { class: 'input', attrs: { id: 'tech-keywords', maxlength: 300 } });
    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'wl-title' } },
      sectionHead(t('settings.watchlist'), 'wl-title'),
      h('p', {
        class: 'sub',
        style: { 'margin-bottom': '16px' },
        text: t('settings.watchlistIntro'),
      }),
      h(
        'ul',
        { class: 'tech-chips', style: { padding: '0', margin: '0', 'list-style': 'none' } },
        config.watchlist.map((entry) =>
          h(
            'li',
            { class: 'tech-chip', attrs: { title: entry.keywords.join(', ') } },
            entry.label,
            h('button', {
              attrs: { type: 'button', 'aria-label': t('settings.remove', { name: entry.label }) },
              text: '✕',
              on: {
                click: () => {
                  save(config.watchlist.filter((w) => w.id !== entry.id));
                },
              },
            }),
          ),
        ),
      ),
      h(
        'form',
        {
          class: 'form-row',
          style: { 'margin-top': '22px', 'align-items': 'end' },
          attrs: { novalidate: true },
          on: {
            submit: (event) => {
              event.preventDefault();
              const name = label.value.trim();
              if (name === '') {
                label.focus();
                return;
              }
              const words = keywords.value
                .split(',')
                .map((k) => k.trim())
                .filter((k) => k !== '');
              const id =
                name
                  .toLowerCase()
                  .normalize('NFKD')
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 40) || `tech-${String(Date.now())}`;
              save([
                ...config.watchlist.filter((w) => w.id !== id),
                {
                  id,
                  label: name,
                  keywords: words.length > 0 ? words.slice(0, 30) : [name],
                  cpePatterns: [],
                  enabled: true,
                },
              ]);
            },
          },
        },
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: 'tech-name' }, text: t('settings.techName') }),
          label,
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: 'tech-keywords' }, text: t('settings.techKeywords') }),
          keywords,
        ),
        h('button', {
          class: 'btn',
          attrs: { type: 'submit' },
          text: `+ ${t('settings.addTech')}`,
        }),
      ),
    );
  }

  // --- Alerts ------------------------------------------------------------------------------

  private alertsBox(): HTMLElement {
    const config = this.config;
    if (!config) return h('div');
    let alerts = { ...config.prefs.alerts };
    const persist = debounce(() => {
      const next: Prefs = { ...prefs.get(), alerts };
      void savePrefs(next).then(() => {
        toast(t('toast.saved'));
      });
    }, 500);
    const range = (
      id: string,
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string,
      apply: (v: number) => void,
    ) => {
      const output = h('output', { attrs: { for: id }, text: format(value) });
      const input = h('input', { attrs: { id, type: 'range', min, max, step, value } });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        output.textContent = format(v);
        apply(v);
        persist();
      });
      return h(
        'div',
        { class: 'range-row' },
        h('label', { attrs: { for: id } }, label, output),
        input,
      );
    };
    const time = (id: string, value: string, apply: (v: string) => void) => {
      const input = h('input', { class: 'input mono', attrs: { id, type: 'time', value } });
      input.addEventListener('change', () => {
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) {
          apply(input.value);
          persist();
        }
      });
      return input;
    };
    const quiet = alerts.quietHours ?? { start: '23:00', end: '07:00' };
    const channel = (key: 'discord' | 'telegram') =>
      h(
        'div',
        { class: 'channel' },
        h('span', { text: t(`settings.channel.${key}`) }),
        h(
          'span',
          { class: 'health', data: { health: config.channels[key] ? 'healthy' : 'unknown' } },
          h('span', { class: 'dot-c', attrs: { 'aria-hidden': 'true' } }),
          t(config.channels[key] ? 'settings.connected' : 'settings.notConfigured'),
        ),
      );
    const testButton = h('button', {
      class: 'btn btn--ghost',
      attrs: { type: 'button' },
      text: t('settings.testAlert'),
    });
    testButton.addEventListener('click', () => {
      testButton.disabled = true;
      api
        .testAlert()
        .then((result) => {
          toast(
            result.sent.length > 0
              ? t('settings.testAlertSent', { channels: result.sent.join(', ') })
              : t('settings.testAlertFailed'),
          );
        })
        .catch((error: unknown) => {
          toast(
            error instanceof ApiError && error.status === 409
              ? t('settings.testAlertNone')
              : t('settings.testAlertFailed'),
          );
        })
        .finally(() => {
          testButton.disabled = false;
        });
    });

    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'al-title' } },
      sectionHead(t('settings.alerts'), 'al-title'),
      h(
        'div',
        { class: 'add-grid', style: { 'margin-top': '0' } },
        h(
          'div',
          null,
          range(
            'al-cvss',
            t('settings.alertCvss'),
            alerts.cvss,
            0,
            10,
            0.5,
            (v) => formatNumber(v, { minimumFractionDigits: 1 }),
            (v) => {
              alerts = { ...alerts, cvss: v };
            },
          ),
          range(
            'al-epss',
            t('settings.alertEpss'),
            Math.round(alerts.epss * 100),
            0,
            100,
            5,
            (v) => `${String(v)} %`,
            (v) => {
              alerts = { ...alerts, epss: v / 100 };
            },
          ),
          range(
            'al-breach',
            t('settings.alertBreach'),
            Math.log10(Math.max(10_000, alerts.breachAccounts)),
            4,
            8,
            0.25,
            (v) => t('brief.accounts', { n: formatCompact(Math.round(10 ** v)) }),
            (v) => {
              alerts = { ...alerts, breachAccounts: Math.round(10 ** v) };
            },
          ),
          range(
            'al-hn',
            t('settings.alertHn'),
            alerts.hnPoints,
            100,
            2000,
            50,
            (v) => t('settings.points', { n: v }),
            (v) => {
              alerts = { ...alerts, hnPoints: v };
            },
          ),
          range(
            'al-max',
            t('settings.alertMax'),
            alerts.maxPerHour,
            1,
            20,
            1,
            (v) => String(v),
            (v) => {
              alerts = { ...alerts, maxPerHour: v };
            },
          ),
        ),
        h(
          'div',
          null,
          channel('discord'),
          channel('telegram'),
          h('p', {
            class: 'sub',
            style: { 'font-size': '13px', margin: '4px 0 14px' },
            text: t('settings.channelHint'),
          }),
          h(
            'div',
            { class: 'setting-row' },
            h('span', { class: 'setting-row__label', text: t('settings.quietHours') }),
            h(
              'div',
              { class: 'time-inputs' },
              h('label', {
                class: 'visually-hidden',
                attrs: { for: 'quiet-from' },
                text: t('settings.quietFrom'),
              }),
              time('quiet-from', quiet.start, (v) => {
                alerts = {
                  ...alerts,
                  quietHours: { start: v, end: alerts.quietHours?.end ?? quiet.end },
                };
              }),
              '–',
              h('label', {
                class: 'visually-hidden',
                attrs: { for: 'quiet-to' },
                text: t('settings.quietTo'),
              }),
              time('quiet-to', quiet.end, (v) => {
                alerts = {
                  ...alerts,
                  quietHours: { start: alerts.quietHours?.start ?? quiet.start, end: v },
                };
              }),
            ),
          ),
          h(
            'div',
            { class: 'setting-row' },
            h('label', {
              class: 'setting-row__label',
              attrs: { for: 'digest-at' },
              text: t('settings.digest'),
            }),
            time('digest-at', alerts.digestAt, (v) => {
              alerts = { ...alerts, digestAt: v };
            }),
          ),
          h('div', { style: { 'margin-top': '16px' } }, testButton),
        ),
      ),
    );
  }

  // --- Display -----------------------------------------------------------------------------

  private displayBox(): HTMLElement {
    const current = prefs.get();
    const seg = <V extends string>(
      label: string,
      options: readonly [V, MessageKey][],
      value: V,
      apply: (v: V) => void,
    ) =>
      h(
        'div',
        { class: 'setting-row' },
        h('span', { class: 'setting-row__label', text: label }),
        h(
          'div',
          { class: 'pn-seg', attrs: { role: 'group', 'aria-label': label } },
          options.map(([v, key]) =>
            h('button', {
              attrs: { type: 'button', 'aria-pressed': String(v === value) },
              style: { 'font-family': 'var(--font-ui)', 'font-size': '13px' },
              text: t(key),
              on: {
                click: () => {
                  apply(v);
                  this.renderPanel();
                },
              },
            }),
          ),
        ),
      );
    const nameInput = h('input', {
      class: 'input',
      attrs: {
        id: 'display-name',
        maxlength: 40,
        value: current.displayName,
        autocomplete: 'given-name',
      },
    });
    nameInput.addEventListener(
      'change',
      () =>
        void savePrefs({ displayName: nameInput.value.trim() }).then(() => {
          toast(t('toast.saved'));
        }),
    );
    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'disp-title' } },
      sectionHead(t('settings.display'), 'disp-title'),
      seg(
        t('settings.theme'),
        [
          ['system', 'settings.themeSystem'],
          ['light', 'settings.themeLight'],
          ['dark', 'settings.themeDark'],
        ] as const,
        current.theme,
        (theme) => void savePrefs({ theme }),
      ),
      seg(
        t('settings.language'),
        [
          ['en', 'lang.en'],
          ['fr', 'lang.fr'],
        ] as const,
        current.lang,
        (code) => void savePrefs({ lang: code }),
      ),
      seg(
        t('settings.density'),
        [
          ['comfortable', 'settings.comfortable'],
          ['compact', 'settings.compact'],
        ] as const,
        current.density,
        (density) => void savePrefs({ density }),
      ),
      h(
        'div',
        { class: 'setting-row' },
        h('span', {
          class: 'setting-row__label',
          attrs: { id: 'rm-label' },
          text: t('settings.reduceMotion'),
        }),
        switchButton({
          checked: current.reduceMotion,
          label: t('settings.reduceMotion'),
          onChange: (reduceMotion) => void savePrefs({ reduceMotion }),
        }),
      ),
      h(
        'div',
        { class: 'setting-row' },
        h('label', {
          class: 'setting-row__label',
          attrs: { for: 'display-name' },
          text: t('settings.displayName'),
        }),
        h('div', { style: { 'min-width': '240px' } }, nameInput),
      ),
    );
  }

  // --- Data --------------------------------------------------------------------------------

  private dataBox(): HTMLElement {
    const exportButton = h('button', {
      class: 'btn btn--ghost',
      attrs: { type: 'button' },
      text: t('settings.export'),
    });
    exportButton.addEventListener('click', () => {
      void api.exportConfig().then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const link = h('a', { attrs: { download: 'panel-config.json' } });
        // Object URLs are same-origin blobs; set directly (h() only allows http(s) or paths).
        link.href = href;
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(href);
        }, 1000);
      });
    });
    const file = h('input', {
      class: 'visually-hidden',
      attrs: { id: 'import-file', type: 'file', accept: 'application/json,.json' },
    });
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      void chosen
        .text()
        .then((text) => api.importConfig(JSON.parse(text) as ExportDto))
        .then((config) => {
          this.config = config;
          prefs.set(config.prefs);
          toast(t('settings.imported'));
        })
        .catch(() => {
          toast(t('settings.importFailed'));
        });
    });
    const row = (label: MessageKey, hint: MessageKey | null, control: HTMLElement) =>
      h(
        'div',
        { class: 'setting-row' },
        h(
          'span',
          { class: 'setting-row__label' },
          t(label),
          hint ? h('span', { class: 'sub', text: t(hint) }) : null,
        ),
        control,
      );
    return h(
      'section',
      { class: 'box s12', attrs: { 'aria-labelledby': 'data-title' } },
      sectionHead(t('settings.data'), 'data-title'),
      row('settings.export', 'settings.exportHint', exportButton),
      row(
        'settings.import',
        null,
        h(
          'label',
          { class: 'btn btn--ghost', attrs: { for: 'import-file' } },
          t('settings.import'),
          file,
        ),
      ),
      row(
        'settings.purge',
        'settings.purgeHint',
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          text: t('settings.purge'),
          on: {
            click: () => {
              clearCache();
              void (
                'caches' in globalThis
                  ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
                  : Promise.resolve()
              ).then(() => {
                toast(t('settings.purged'));
              });
            },
          },
        }),
      ),
      isDemo
        ? null
        : row(
            'settings.backup',
            'settings.backupHint',
            h('a', {
              class: 'btn btn--ghost',
              attrs: { href: '/api/backup', download: 'panel-backup.db' },
              text: t('settings.backup'),
            }),
          ),
      isDemo
        ? null
        : row(
            'settings.logout',
            null,
            h('button', {
              class: 'btn',
              attrs: { type: 'button' },
              text: t('settings.logout'),
              on: { click: () => void logout() },
            }),
          ),
    );
  }
}
