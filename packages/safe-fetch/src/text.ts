import sanitizeHtml from 'sanitize-html';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

const ENTITY = /&(#\d{1,7}|#x[\da-f]{1,6}|lt|gt|amp|quot|apos|nbsp);/gi;

/**
 * Decodes the five XML entities, `&nbsp;` and numeric references, in a single pass:
 * "&amp;lt;" becomes "&lt;", never "<" (no double decoding, no expansion beyond one character).
 */
export function decodeXmlEntities(input: string): string {
  return input.replace(ENTITY, (_match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid =
        codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
      return valid ? String.fromCodePoint(codePoint) : '\ufffd';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? '';
  });
}

/** Strips every tag; script/style/etc. contents are dropped entirely (SPEC § 2, `allowedTags: []`). */
export function htmlToText(html: string): string {
  const text = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: [
      'script',
      'style',
      'textarea',
      'option',
      'noscript',
      'iframe',
      'template',
      'svg',
      'math',
      'head',
    ],
  });
  // sanitize-html escapes text for HTML output; we want raw text (rendered with textContent).
  return decodeXmlEntities(text);
}

// C0/C1 controls except tab and newline, plus invisible and bidi-override characters that can
// spoof titles ("Trojan Source"-style reordering) or hide content.
/* eslint-disable no-control-regex -- matching control characters is the point */
const INVISIBLE =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */
const WHITESPACE = /\s+/g;

/** Normalizes, removes control/bidi characters, collapses whitespace and truncates on a code point. */
export function cleanText(input: string, maxLength: number): string {
  const cleaned = input.normalize('NFC').replace(INVISIBLE, '').replace(WHITESPACE, ' ').trim();
  const codePoints = Array.from(cleaned);
  if (codePoints.length <= maxLength) return cleaned;
  return `${codePoints
    .slice(0, Math.max(0, maxLength - 1))
    .join('')
    .trimEnd()}…`;
}

/**
 * Full pipeline for a field coming from a feed: entity references are decoded (feeds often
 * carry escaped HTML), markup is removed, then the text is cleaned and truncated.
 */
export function toPlainText(raw: string, maxLength: number): string {
  return cleanText(htmlToText(decodeXmlEntities(raw)), maxLength);
}
