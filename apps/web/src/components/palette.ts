import type { SearchDto } from '@panel/shared';
import { POLL_EVENT, savePrefs } from '../app-context.js';
import { api } from '../lib/api.js';
import { h, mount } from '../lib/h.js';
import { t, type MessageKey } from '../lib/i18n.js';
import { paused } from '../lib/state.js';
import { openCveDrawer } from './drawer.js';
import { cveTitle } from './ui.js';

interface Option {
  group: MessageKey;
  label: string;
  hint?: string;
  run: () => void;
}

const COMMANDS: readonly { match: string; label: MessageKey; run: () => void }[] = [
  {
    match: 'theme dark',
    label: 'palette.cmdThemeDark',
    run: () => void savePrefs({ theme: 'dark' }),
  },
  {
    match: 'theme light',
    label: 'palette.cmdThemeLight',
    run: () => void savePrefs({ theme: 'light' }),
  },
  {
    match: 'theme system',
    label: 'palette.cmdThemeSystem',
    run: () => void savePrefs({ theme: 'system' }),
  },
  {
    match: 'sync',
    label: 'palette.cmdSync',
    run: () => document.dispatchEvent(new CustomEvent(POLL_EVENT)),
  },
  {
    match: 'pause',
    label: 'palette.cmdPause',
    run: () => {
      paused.set(!paused.get());
    },
  },
];

function searchOptions(result: SearchDto): Option[] {
  const external = (url: string) => () => window.open(url, '_blank', 'noopener,noreferrer');
  return [
    ...result.cves.map((c) => ({
      group: 'palette.threats' as const,
      label: c.cveId,
      hint: cveTitle(c, document.documentElement.lang === 'fr' ? 'fr' : 'en'),
      run: () => {
        openCveDrawer(c.cveId);
      },
    })),
    ...result.items.map((i) => ({
      group: 'palette.articles' as const,
      label: i.title,
      hint: i.sourceName,
      run: external(i.url),
    })),
    ...result.repos.map((r) => ({
      group: 'palette.repos' as const,
      label: r.fullName,
      hint: r.language ?? '',
      run: external(r.url),
    })),
    ...result.releases.map((r) => ({
      group: 'palette.releases' as const,
      label: `${r.product} ${r.version}`,
      run: external(r.url),
    })),
  ];
}

/**
 * Command palette (SPEC § 4.3 F): ⌘K / Ctrl K or `/`. Full-text search (FTS5 on the server)
 * and `>` commands. A combobox with a listbox: arrows move, Enter runs, Esc closes.
 */
function open(): void {
  if (document.querySelector('.palette')) return;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = h('input', {
    class: 'input palette__input',
    attrs: {
      type: 'text',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'palette-list',
      'aria-autocomplete': 'list',
      'aria-label': t('palette.label'),
      placeholder: t('palette.placeholder'),
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: 100,
    },
  });
  const list = h('div', {
    class: 'palette__results',
    attrs: { id: 'palette-list', role: 'listbox', 'aria-label': t('palette.label') },
  });
  const scrim = h('div', {
    class: 'scrim',
    style: { 'z-index': '80' },
    attrs: { 'aria-hidden': 'true' },
  });
  const dialog = h(
    'div',
    {
      class: 'palette',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.label') },
    },
    input,
    list,
    h('p', { class: 'palette__hint', text: t('palette.hint') }),
  );
  let options: Option[] = [];
  let active = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const render = () => {
    if (options.length === 0) {
      mount(
        list,
        input.value.trim() === '' ? null : h('p', { class: 'empty', text: t('palette.noResults') }),
      );
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let group: MessageKey | null = null;
    const nodes: HTMLElement[] = [];
    options.forEach((option, index) => {
      if (option.group !== group) {
        group = option.group;
        nodes.push(
          h('p', {
            class: 'eyebrow palette__group',
            attrs: { role: 'presentation' },
            text: t(option.group),
          }),
        );
      }
      nodes.push(
        h(
          'div',
          {
            class: 'palette__option',
            attrs: {
              id: `palette-opt-${String(index)}`,
              role: 'option',
              'aria-selected': String(index === active),
            },
            on: {
              click: () => {
                choose(index);
              },
              mousemove: () => {
                if (active !== index) {
                  active = index;
                  render();
                }
              },
            },
          },
          h('span', { text: option.label }),
          option.hint
            ? h('span', { class: 'sub', style: { 'font-size': '12.5px' }, text: option.hint })
            : null,
        ),
      );
    });
    mount(list, nodes);
    input.setAttribute('aria-activedescendant', `palette-opt-${String(active)}`);
    list.querySelector(`#palette-opt-${String(active)}`)?.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    controller?.abort();
    dialog.remove();
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    opener?.focus({ preventScroll: true });
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    close();
    option.run();
  };

  const search = () => {
    const query = input.value.trim();
    active = 0;
    if (query.startsWith('>')) {
      const term = query.slice(1).trim().toLowerCase();
      options = COMMANDS.filter(
        (c) => c.match.includes(term) || t(c.label).toLowerCase().includes(term),
      ).map((c) => ({
        group: 'palette.commands',
        label: t(c.label),
        hint: `>${c.match}`,
        run: c.run,
      }));
      render();
      return;
    }
    if (query === '') {
      options = [];
      render();
      return;
    }
    controller?.abort();
    controller = new AbortController();
    api
      .search(query, controller.signal)
      .then((result) => {
        options = searchOptions(result);
        render();
      })
      .catch(() => undefined);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Tab') {
      // Focus stays in the input: the listbox is driven by aria-activedescendant.
      event.preventDefault();
      input.focus();
    }
  };

  input.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(search, 180);
  });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim, dialog);
  input.focus();
}

/** Global shortcuts (SPEC § 4.3 C): disabled while typing in a field. */
export function installShortcuts(): void {
  document.addEventListener('pn:palette', open);
  document.addEventListener('keydown', (event) => {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.matches('input, textarea, select') || event.target.isContentEditable);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') {
      event.preventDefault();
      open();
    }
  });
}
