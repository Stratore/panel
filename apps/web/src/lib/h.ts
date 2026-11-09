/**
 * The only way the front-end builds DOM (SPEC § 0.2): elements are created with
 * `createElement`, text goes through `textContent` (text nodes), styles through CSSOM.
 * HTML strings are never parsed, inline handlers and `style` attributes are refused, and
 * URL attributes only accept same-site paths or http(s) links.
 */

export type Child = Node | string | number | null | undefined | false | readonly Child[];

type Listener<K extends keyof HTMLElementEventMap> = (event: HTMLElementEventMap[K]) => void;

export interface Props {
  class?: string | readonly (string | false | null | undefined)[];
  /** Plain attributes; `true` sets an empty attribute, `false`/`undefined` omits it. */
  attrs?: Readonly<Record<string, string | number | boolean | undefined>>;
  data?: Readonly<Record<string, string | undefined>>;
  /** CSS custom properties or properties, applied with `style.setProperty`. */
  style?: Readonly<Record<string, string | undefined>>;
  on?: { [K in keyof HTMLElementEventMap]?: Listener<K> };
  text?: string;
}

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const FORBIDDEN_ATTRIBUTES = new Set(['style', 'srcdoc']);

/** Same-site paths (`/x`, `#x`, `?x`) or absolute http(s) URLs; everything else is dropped. */
export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//') && !trimmed.startsWith('/\\');
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function setAttribute(
  el: Element,
  name: string,
  value: string | number | boolean | undefined,
): void {
  const lower = name.toLowerCase();
  if (value === undefined || value === false) return;
  if (lower.startsWith('on') || FORBIDDEN_ATTRIBUTES.has(lower)) return;
  const text = value === true ? '' : String(value);
  if (URL_ATTRIBUTES.has(lower) && !isSafeUrl(text)) return;
  el.setAttribute(name, text);
}

function className(value: Props['class']): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value.filter(Boolean).join(' ');
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child as readonly Child[]);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child as string | number)));
  }
}

function apply(el: Element & ElementCSSInlineStyle, props: Props): void {
  const cls = className(props.class);
  if (cls !== '') el.setAttribute('class', cls);
  for (const [name, value] of Object.entries(props.attrs ?? {})) setAttribute(el, name, value);
  for (const [name, value] of Object.entries(props.data ?? {})) {
    if (value !== undefined) el.setAttribute(`data-${name}`, value);
  }
  for (const [name, value] of Object.entries(props.style ?? {})) {
    if (value !== undefined) el.style.setProperty(name, value);
  }
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, listener as EventListener);
  }
  if (props.text !== undefined) el.textContent = props.text;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) apply(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG counterpart of `h` (icons and hand-made charts). */
export function svg(
  tag: string,
  attrs: Readonly<Record<string, string | number | undefined>> = {},
  ...children: Child[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) setAttribute(el, name, value);
  append(el, children);
  return el;
}

/** Replaces all children (never via innerHTML). */
export function mount(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}
