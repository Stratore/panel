import type { Lang } from '@panel/shared';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { createStore } from './store.js';

export type MessageKey = keyof typeof en;

const CATALOGS: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { en, fr };
const LOCALES: Readonly<Record<Lang, string>> = { en: 'en-US', fr: 'fr-FR' };

/** Current interface language (SPEC § 5). Article content is never translated. */
export const lang = createStore<Lang>('en');

/** Translates a key, replacing `{name}` placeholders. Missing params are left visible. */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  const template = CATALOGS[lang.get()][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export const locale = (): string => LOCALES[lang.get()];

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale(), options).format(value);
}

/** 12.4M / 12,4 M */
export const formatCompact = (value: number): string =>
  formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 });

export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(locale(), options).format(
    typeof date === 'string' ? new Date(date) : date,
  );
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "2 hours ago" / "il y a 2 heures"; under a minute reads "now". */
export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const seconds = Math.round(
    ((typeof date === 'string' ? Date.parse(date) : date.getTime()) - now.getTime()) / 1000,
  );
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** Short age for badges: "2h", "3d", "now". */
export function formatAge(date: Date | string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return lang.get() === 'fr' ? 'maint.' : 'now';
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;
  return `${String(Math.round(hours / 24))} ${lang.get() === 'fr' ? 'j' : 'd'}`;
}

export const catalogs = CATALOGS;
