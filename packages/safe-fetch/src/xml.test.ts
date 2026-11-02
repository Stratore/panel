import { describe, expect, it } from 'vitest';
import { SafeFetchError } from './errors.js';
import { parseXmlSafe } from './xml.js';

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SafeFetchError);
    expect((error as SafeFetchError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
};

describe('parseXmlSafe', () => {
  it('parses a simple RSS document, keeping values as strings', () => {
    const doc = parseXmlSafe(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>' +
        '<item><title>A &amp; B</title><guid isPermaLink="false">0x10</guid></item></channel></rss>',
    ) as {
      rss: { channel: { title: string; item: { title: string; guid: { '#text': string } } } };
    };
    expect(doc.rss.channel.title).toBe('Feed');
    // Entities are not expanded by the parser; decodeXmlEntities handles them later.
    expect(doc.rss.channel.item.title).toBe('A &amp; B');
    expect(doc.rss.channel.item.guid['#text']).toBe('0x10');
  });

  it('merges CDATA into text', () => {
    const doc = parseXmlSafe('<a><b><![CDATA[<p>hi</p>]]></b></a>') as { a: { b: string } };
    expect(doc.a.b).toBe('<p>hi</p>');
  });

  it('rejects a billion-laughs document before parsing', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>' +
      '<lolz>&lol2;</lolz>';
    expectCode(() => parseXmlSafe(bomb), 'XML_FORBIDDEN_DECLARATION');
  });

  it.each([
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    '<!doctype html><html></html>',
    '<foo><!ENTITY x "y"></foo>',
    '<?xml version="1.0"?>\n  <!DocType rss SYSTEM "http://169.254.169.254/">\n<rss/>',
  ])('rejects DTD/ENTITY declarations: %s', (xml) => {
    expectCode(() => parseXmlSafe(xml), 'XML_FORBIDDEN_DECLARATION');
  });

  it('rejects excessive nesting', () => {
    const deep = `${'<a>'.repeat(200)}x${'</a>'.repeat(200)}`;
    expect(() => parseXmlSafe(deep)).toThrow(SafeFetchError);
  });

  it.each(['<rss><channel></rss>', 'not xml at all <', '<a b></a>'])(
    'rejects malformed XML %j',
    (xml) => {
      expectCode(() => parseXmlSafe(xml), 'XML_INVALID');
    },
  );

  it('rejects oversized documents', () => {
    expectCode(() => parseXmlSafe(`<a>${'x'.repeat(6 * 1024 * 1024)}</a>`), 'TOO_LARGE');
  });

  it('does not pollute Object.prototype through tag names', () => {
    try {
      parseXmlSafe('<root><__proto__><polluted>yes</polluted></__proto__></root>');
    } catch {
      // Refusing the document is also acceptable.
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
