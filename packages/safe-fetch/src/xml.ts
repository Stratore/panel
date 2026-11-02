import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SafeFetchError } from './errors.js';

export const XML_LIMITS = {
  maxChars: 5 * 1024 * 1024,
  maxNestedTags: 64,
} as const;

/** Rejected before parsing: no DTD means no XXE and no entity-expansion bomb (SPEC § 9.4). */
const FORBIDDEN_DECLARATION = /<!(?:DOCTYPE|ENTITY)/i;

const parser = new XMLParser({
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep every value as a string: no numeric coercion surprises ("1e999", "0x10").
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  maxNestedTags: XML_LIMITS.maxNestedTags,
});

/**
 * Parses untrusted XML into a plain object tree. Entities are NOT expanded: text keeps
 * `&amp;`-style references, decoded later by `decodeXmlEntities` (one level, no recursion).
 * The result is `unknown` on purpose: adapters validate it with Zod.
 */
export function parseXmlSafe(xml: string): unknown {
  if (xml.length > XML_LIMITS.maxChars) {
    throw new SafeFetchError('TOO_LARGE', 'XML document is too large');
  }
  if (FORBIDDEN_DECLARATION.test(xml)) {
    throw new SafeFetchError(
      'XML_FORBIDDEN_DECLARATION',
      'DOCTYPE and ENTITY declarations are not allowed',
    );
  }
  // Strict well-formedness check (the parser alone accepts truncated documents). Deprecated in
  // favour of the separate fast-xml-validator package; kept to avoid a new dependency (ADR-017).
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) {
    throw new SafeFetchError('XML_INVALID', `Malformed XML (line ${String(validation.err.line)})`);
  }
  try {
    return parser.parse(xml) as unknown;
  } catch (cause) {
    throw new SafeFetchError('XML_INVALID', 'XML could not be parsed', { cause });
  }
}
