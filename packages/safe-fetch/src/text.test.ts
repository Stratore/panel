import { describe, expect, it } from 'vitest';
import { cleanText, decodeXmlEntities, htmlToText, toPlainText } from './text.js';

describe('decodeXmlEntities', () => {
  it('decodes named and numeric references', () => {
    expect(
      decodeXmlEntities('&lt;b&gt; &amp; &quot;x&quot; &apos;y&apos; &#233; &#xE9; &nbsp;'),
    ).toBe('<b> & "x" \'y\' é é \u00a0');
  });

  it('decodes a single level only', () => {
    expect(decodeXmlEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('replaces invalid code points and leaves unknown entities alone', () => {
    expect(decodeXmlEntities('&#0;&#xD800;&#x110000;')).toBe('\ufffd\ufffd\ufffd');
    expect(decodeXmlEntities('&copy; &unknown;')).toBe('&copy; &unknown;');
  });
});

describe('htmlToText', () => {
  it('drops tags, attributes and the content of dangerous elements', () => {
    expect(
      htmlToText(
        '<p onclick="x()">Hello <b>world</b></p><script>alert(1)</script><style>p{}</style>' +
          '<img src=x onerror=alert(1)><iframe src="javascript:alert(1)">inner</iframe><a href="javascript:alert(1)">link</a>',
      ),
    ).toBe('Hello worldlink');
  });

  it('returns raw text, not HTML-escaped text', () => {
    expect(htmlToText('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });
});

describe('cleanText', () => {
  it('removes control, zero-width and bidi override characters', () => {
    expect(cleanText('a\u0000b\u0007c\u200bd\u202eevil\u202c\ufeff', 100)).toBe('abcdevil');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanText('  one\n\n two\t three  ', 100)).toBe('one two three');
  });

  it('truncates on code points with an ellipsis', () => {
    expect(cleanText('abcdef', 4)).toBe('abc…');
    expect(cleanText('😀😀😀😀😀', 3)).toBe('😀😀…');
    expect(cleanText('abc', 3)).toBe('abc');
  });
});

describe('toPlainText', () => {
  it('neutralizes escaped HTML coming from a feed', () => {
    expect(
      toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;', 300),
    ).toBe('Hi & bye');
  });

  it('keeps plain titles intact', () => {
    expect(toPlainText('CVE-2026-41234: PHP < 8.3.14 is affected', 300)).toBe(
      'CVE-2026-41234: PHP < 8.3.14 is affected',
    );
  });

  it('enforces the length limit', () => {
    expect(Array.from(toPlainText('x'.repeat(5000), 1000))).toHaveLength(1000);
  });
});
