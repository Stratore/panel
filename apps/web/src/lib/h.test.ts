// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, isSafeUrl, mount, svg } from './h.js';

describe('h()', () => {
  it('creates elements with classes, attributes, data and text', () => {
    const el = h(
      'a',
      {
        class: ['link', false, 'big'],
        attrs: { href: '/brief', 'aria-current': 'page', hidden: false },
        data: { id: '7' },
      },
      'Brief',
    );
    expect(el.tagName).toBe('A');
    expect(el.className).toBe('link big');
    expect(el.getAttribute('href')).toBe('/brief');
    expect(el.getAttribute('aria-current')).toBe('page');
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.dataset['id']).toBe('7');
    expect(el.textContent).toBe('Brief');
  });

  it('never parses HTML: markup stays literal text', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)>', h('b', { text: '<script>' }));
    expect(el.childElementCount).toBe(1);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)><script>');
    expect(el.querySelector('img')).toBeNull();
  });

  it('drops inline handlers, style attributes and unsafe URLs', () => {
    const el = h('a', {
      attrs: {
        onclick: 'alert(1)',
        ONMOUSEOVER: 'x',
        style: 'color:red',
        srcdoc: '<b>',
        href: 'javascript:alert(1)',
      },
    });
    expect(el.getAttributeNames()).toEqual([]);
    expect(
      h('img', { attrs: { src: 'data:image/svg+xml,<svg onload=alert(1)>' } }).hasAttribute('src'),
    ).toBe(false);
    expect(h('a', { attrs: { href: '//evil.example/x' } }).hasAttribute('href')).toBe(false);
    expect(h('a', { attrs: { href: 'https://example.com/a' } }).getAttribute('href')).toBe(
      'https://example.com/a',
    );
  });

  it('applies styles through CSSOM and attaches listeners', () => {
    const onClick = vi.fn();
    const el = h('button', {
      style: { '--accent': '#000', width: '10px' },
      on: { click: onClick },
    });
    el.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(el.style.getPropertyValue('--accent')).toBe('#000');
    expect(el.style.getPropertyValue('width')).toBe('10px');
  });

  it('flattens nested children and skips empty ones', () => {
    const el = h('ul', null, [h('li', { text: 'a' }), null, false, [h('li', { text: 'b' }), 3]]);
    expect(el.textContent).toBe('ab3');
  });

  it('creates SVG in the SVG namespace and refuses unsafe hrefs there too', () => {
    const el = svg('svg', { viewBox: '0 0 10 10' }, svg('use', { href: 'javascript:alert(1)' }));
    expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.firstElementChild?.hasAttribute('href')).toBe(false);
  });

  it('mounts by replacing children', () => {
    const root = h('div', null, h('span'), h('span'));
    mount(root, 'only');
    expect(root.childNodes).toHaveLength(1);
    expect(root.textContent).toBe('only');
  });
});

describe('isSafeUrl', () => {
  it.each(['/a', '/a?b=1', '#top', '?q=1', 'https://x.example', 'http://x.example/a'])(
    'accepts %s',
    (url) => {
      expect(isSafeUrl(url)).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    '//evil.example',
    '/\\evil.example',
    'mailto:a@b.c',
    '',
  ])('refuses %j', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});
