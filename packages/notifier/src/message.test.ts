import { describe, expect, it } from 'vitest';
import { cleanText, escapeDiscord, escapeTelegramHtml, safeLink, truncate } from './escape.js';
import { discordPayload, renderText, telegramPayload, type AlertMessage } from './message.js';

const RLO = String.fromCodePoint(0x202e);
const ZWJ = String.fromCodePoint(0x200d);

const message = (over: Partial<AlertMessage> = {}): AlertMessage => ({
  key: 'kev:CVE-2026-41234',
  covers: [],
  rule: 'kev',
  headline: 'KEV · CRITICAL 9.8 · EPSS 94%',
  lines: ['CVE-2026-41234 — PHP < 8.3.14 · Remote code execution', 'Fix: upgrade to 8.3.14'],
  url: 'https://panel.example.org/threats/CVE-2026-41234',
  ...over,
});

describe('cleanText and truncate', () => {
  it('removes control, bidi and invisible characters and folds whitespace', () => {
    const nul = String.fromCodePoint(0);
    expect(cleanText(`a${RLO}b${ZWJ}c\n\td  e${nul}`)).toBe('a b c d e');
  });

  it('cuts on code points and marks the cut', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
    expect(truncate('🔥🔥🔥🔥🔥', 3)).toBe('🔥🔥…');
  });
});

describe('Telegram escaping (HTML mode)', () => {
  it('escapes &, <, > and quotes', () => {
    expect(escapeTelegramHtml('<b>Tom & "Jerry"</b>')).toBe(
      '&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;',
    );
  });

  it('never lets feed markup through and disables previews', () => {
    const payload = telegramPayload(
      message({
        headline: '<a href="https://evil.example">click</a>',
        lines: ['<script>alert(1)</script> & co', '<tg-spoiler>x</tg-spoiler>'],
      }),
      '-100123',
    );
    const text = String(payload['text']);
    expect(text).not.toMatch(/<(a href="https:\/\/evil|script|tg-spoiler)/);
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(text.startsWith('🔥 <b>&lt;a href=&quot;')).toBe(true);
    expect(payload).toMatchObject({
      chat_id: '-100123',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
    });
  });

  it('only links http(s) URLs and escapes them', () => {
    const js = telegramPayload(message({ url: 'javascript:alert(1)' }), '1');
    expect(String(js['text'])).not.toContain('javascript');
    const quoted = telegramPayload(message({ url: 'https://x.example/?a="b"&c=<d>' }), '1');
    expect(String(quoted['text'])).toContain('href="https://x.example/?a=%22b%22&amp;c=%3Cd%3E"');
  });

  it('stays under the 4096 character limit without cutting an entity', () => {
    const lines = Array.from({ length: 30 }, () => '<&>'.repeat(200));
    const text = String(telegramPayload(message({ lines }), '1')['text']);
    expect(text.length).toBeLessThan(4096);
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});

describe('Discord escaping', () => {
  it('neutralises mentions and markdown', () => {
    const zw = String.fromCodePoint(0x200b);
    expect(escapeDiscord('@everyone **bold** [x](https://e.example) `c` <@123>')).toBe(
      [
        '@',
        zw,
        'everyone \\*\\*bold\\*\\* \\[x\\]\\(https\\://e.example\\) \\`c\\` \\<@',
        zw,
        '123\\>',
      ].join(''),
    );
  });

  it('always sends an empty allowed_mentions list', () => {
    const payload = discordPayload(message({ headline: '@here alert', lines: ['@everyone ping'] }));
    expect(payload['allowed_mentions']).toEqual({ parse: [] });
    expect(JSON.stringify(payload)).not.toMatch(/@(everyone|here)/);
    expect(payload).not.toHaveProperty('content');
  });

  it('keeps embed limits and drops non-http links', () => {
    const payload = discordPayload(
      message({ headline: 'h'.repeat(500), lines: ['l'.repeat(1000)], url: 'data:text/html,x' }),
    );
    const [embed] = payload['embeds'] as Record<string, unknown>[];
    expect(String(embed?.['title']).length).toBeLessThanOrEqual(256);
    expect(String(embed?.['description']).length).toBeLessThanOrEqual(4000);
    expect(embed).not.toHaveProperty('url');
  });
});

describe('plain text format (SPEC § 7.10)', () => {
  it('matches the reference layout', () => {
    expect(renderText(message())).toBe(
      [
        '🔥 KEV · CRITICAL 9.8 · EPSS 94%',
        'CVE-2026-41234 — PHP < 8.3.14 · Remote code execution',
        'Fix: upgrade to 8.3.14',
        '→ https://panel.example.org/threats/CVE-2026-41234',
      ].join('\n'),
    );
  });

  it('accepts only absolute http(s) links', () => {
    expect(safeLink('https://a.example/x')).toBe('https://a.example/x');
    expect(safeLink('ftp://a.example')).toBeNull();
    expect(safeLink('/relative')).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});
