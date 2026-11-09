import { SafeFetchError, type SafeFetch } from '@panel/safe-fetch';
import { discordPayload, telegramPayload, type AlertMessage } from './message.js';

export const ALERT_CHANNELS = ['discord', 'telegram'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export interface Channel {
  name: AlertChannel;
  /** Resolves once the platform accepted the message; throws a `NotifierError` otherwise. */
  send(message: AlertMessage): Promise<void>;
}

/**
 * Carries only the channel and a short reason: never the webhook URL or bot token, which are
 * secrets (SPEC § 9.6), so the error can be logged as is.
 */
export class NotifierError extends Error {
  constructor(
    readonly channel: AlertChannel,
    readonly reason: string,
  ) {
    super(`${channel}: ${reason}`);
    this.name = 'NotifierError';
  }
}

export interface ChannelSecrets {
  discordWebhookUrl?: string | undefined;
  telegramBotToken?: string | undefined;
  telegramChatId?: string | undefined;
}

const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);

/** Only genuine Discord webhook URLs are accepted, so the setting cannot aim the POST elsewhere. */
export function isDiscordWebhook(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      DISCORD_HOSTS.has(parsed.hostname) &&
      /^\/api\/webhooks\/\d{5,30}\/[\w-]{20,200}$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export const isTelegramToken = (token: string): boolean => /^\d{5,15}:[\w-]{30,60}$/.test(token);
export const isTelegramChatId = (id: string): boolean =>
  /^-?\d{1,20}$/.test(id) || /^@\w{5,32}$/.test(id);

const reasonOf = (error: unknown): string =>
  error instanceof SafeFetchError ? error.code : 'NETWORK_ERROR';

async function post(
  channel: AlertChannel,
  safeFetch: SafeFetch,
  url: string,
  body: Record<string, unknown>,
): Promise<string> {
  let response;
  try {
    response = await safeFetch(url, {
      trust: 'default',
      json: JSON.stringify(body),
      maxBytes: 64 * 1024,
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new NotifierError(channel, reasonOf(error));
  }
  if (response.status < 200 || response.status >= 300) {
    throw new NotifierError(channel, `HTTP ${String(response.status)}`);
  }
  return response.body;
}

export function discordChannel(webhookUrl: string, safeFetch: SafeFetch): Channel {
  return {
    name: 'discord',
    async send(message) {
      await post('discord', safeFetch, webhookUrl, discordPayload(message));
    },
  };
}

/** The Bot API answers `{"ok": true, …}` on success, even with HTTP 200 on some errors. */
function telegramAccepted(body: string): boolean {
  try {
    return (JSON.parse(body) as { ok?: unknown } | null)?.ok === true;
  } catch {
    return false;
  }
}

export function telegramChannel(token: string, chatId: string, safeFetch: SafeFetch): Channel {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  return {
    name: 'telegram',
    async send(message) {
      const body = await post('telegram', safeFetch, url, telegramPayload(message, chatId));
      if (!telegramAccepted(body)) throw new NotifierError('telegram', 'API refused the message');
    },
  };
}

export interface ChannelSetup {
  channels: Channel[];
  /** Secrets that are set but malformed (reported once at startup, values never logged). */
  invalid: string[];
}

/** Builds the configured channels; a malformed secret disables its channel instead of crashing. */
export function createChannels(secrets: ChannelSecrets, safeFetch: SafeFetch): ChannelSetup {
  const channels: Channel[] = [];
  const invalid: string[] = [];
  const { discordWebhookUrl, telegramBotToken, telegramChatId } = secrets;
  if (discordWebhookUrl !== undefined) {
    if (isDiscordWebhook(discordWebhookUrl))
      channels.push(discordChannel(discordWebhookUrl, safeFetch));
    else invalid.push('DISCORD_WEBHOOK_URL');
  }
  if (telegramBotToken !== undefined || telegramChatId !== undefined) {
    if (telegramBotToken === undefined || !isTelegramToken(telegramBotToken))
      invalid.push('TELEGRAM_BOT_TOKEN');
    else if (telegramChatId === undefined || !isTelegramChatId(telegramChatId))
      invalid.push('TELEGRAM_CHAT_ID');
    else channels.push(telegramChannel(telegramBotToken, telegramChatId, safeFetch));
  }
  return { channels, invalid };
}
