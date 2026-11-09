import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cleanText, escapeDiscord, escapeTelegramHtml, safeLink, truncate } from './escape.js';

export const ALERT_RULES = ['kev', 'crit', 'breach', 'certfr', 'hn', 'digest', 'test'] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

/**
 * A channel-neutral alert. It is stored as JSON in `alert_queue` until the digest, so it is
 * validated again when read back.
 */
export const alertMessageSchema = z.strictObject({
  /** Dedupe key, e.g. `kev:CVE-2026-41234` (SPEC § 7.10). */
  key: z.string().min(1).max(200),
  /** Other keys this alert also settles (a KEV alert covers the "critical" alert of its CVE). */
  covers: z.array(z.string().min(1).max(200)).max(5),
  rule: z.enum(ALERT_RULES),
  /** First line, e.g. "KEV · CRITICAL 9.8 · EPSS 94%". */
  headline: z.string().max(300),
  /** Following lines, e.g. the CVE one-liner and the fix. */
  lines: z.array(z.string().max(1000)).max(30),
  url: z.string().max(2048).nullable(),
});
export type AlertMessage = z.infer<typeof alertMessageSchema>;

const LIMITS = { headline: 200, line: 300, lines: 25 } as const;
/** The only emoji Panel ever uses, and only in bot messages (SPEC § 7.10). */
const FIRE = '🔥';
const ELLIPSIS = String.fromCodePoint(0x2026);

function parts(message: AlertMessage): { headline: string; lines: string[]; url: string | null } {
  return {
    headline: truncate(cleanText(message.headline), LIMITS.headline),
    lines: message.lines
      .slice(0, LIMITS.lines)
      .map((line) => truncate(cleanText(line), LIMITS.line))
      .filter((line) => line !== ''),
    url: safeLink(message.url),
  };
}

/**
 * Joins already-escaped lines, dropping whole lines once `max` would be exceeded: escaped markup
 * is never cut in the middle (a half entity or a dangling backslash).
 */
function fit(lines: string[], max: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > max) {
      kept.push(ELLIPSIS);
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

/** Plain-text form (logs, hashing, tests). */
export function renderText(message: AlertMessage): string {
  const { headline, lines, url } = parts(message);
  return [`${FIRE} ${headline}`, ...lines, ...(url === null ? [] : [`→ ${url}`])].join('\n');
}

export function payloadHash(message: AlertMessage): string {
  return createHash('sha256').update(renderText(message)).digest('hex');
}

const DISCORD_COLORS: Record<AlertRule, number> = {
  kev: 0xd70015,
  crit: 0xd70015,
  breach: 0xb25000,
  certfr: 0x0071e3,
  hn: 0xff6600,
  digest: 0x6e6e73,
  test: 0x248a3d,
};

/** Discord webhook body: one embed, no mention can ever be parsed. */
export function discordPayload(message: AlertMessage): Record<string, unknown> {
  const { headline, lines, url } = parts(message);
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(`${FIRE} ${escapeDiscord(headline)}`, 256),
        description: fit(lines.map(escapeDiscord), 4000),
        ...(url === null ? {} : { url }),
        color: DISCORD_COLORS[message.rule],
      },
    ],
  };
}

/** Telegram `sendMessage` body: HTML mode with every external string escaped, no previews. */
export function telegramPayload(message: AlertMessage, chatId: string): Record<string, unknown> {
  const { headline, lines, url } = parts(message);
  const html = [
    `${FIRE} <b>${escapeTelegramHtml(headline)}</b>`,
    fit(lines.map(escapeTelegramHtml), 3500),
    ...(url === null
      ? []
      : [`→ <a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(url)}</a>`]),
  ].join('\n');
  return {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    link_preview_options: { is_disabled: true },
  };
}
