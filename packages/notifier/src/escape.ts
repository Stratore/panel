// Everything a bot posts comes from hostile feeds (SPEC § 9.1): it is cleaned, escaped for the
// target markup and truncated before it leaves the process.

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ELLIPSIS = String.fromCodePoint(0x2026);

/**
 * Drops control and invisible format characters (bidi overrides, zero-width joiners…) that
 * could reorder or hide text, and folds whitespace. Newlines are dropped too: every line of a
 * message is built by the notifier, never by a feed.
 */
export function cleanText(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Cuts on grapheme clusters (never inside an emoji or an accented letter) and marks the cut
 * with an ellipsis. `max` counts graphemes; callers keep a margin under platform limits.
 */
export function truncate(text: string, max: number): string {
  const parts = Array.from(graphemes.segment(text), (s) => s.segment);
  if (parts.length <= max) return text;
  return `${parts
    .slice(0, Math.max(0, max - 1))
    .join('')
    .trimEnd()}${ELLIPSIS}`;
}

/**
 * Telegram `parse_mode: "HTML"`: `&`, `<` and `>` must be escaped in text; `"` is escaped too so
 * the same function is safe inside an `href` attribute.
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Discord markdown: every formatting character is backslash-escaped (no bold, links, code
 * blocks, headings or spoilers from a feed title), and `@` gets a zero-width space so
 * `@everyone` cannot even look like a mention. `allowed_mentions: { parse: [] }` is the actual
 * guarantee that nobody is pinged.
 */
export function escapeDiscord(text: string): string {
  return text.replace(/[\\*_~`|>#[\]()<:-]/g, '\\$&').replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

/** Only absolute http(s) URLs are ever linked. */
export function safeLink(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
