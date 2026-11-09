import { SafeFetchError, type SafeFetch, type SafeFetchOptions } from '@panel/safe-fetch';
import { describe, expect, it } from 'vitest';
import {
  createChannels,
  discordChannel,
  isDiscordWebhook,
  isTelegramChatId,
  isTelegramToken,
  NotifierError,
  telegramChannel,
} from './channels.js';
import type { AlertMessage } from './message.js';

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123';
const TOKEN = '123456789:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQr';

const message: AlertMessage = {
  key: 'test',
  covers: [],
  rule: 'test',
  headline: 'Test @everyone',
  lines: ['<b>hi</b>'],
  url: null,
};

interface Call {
  url: string;
  options: SafeFetchOptions | undefined;
}

function fakeFetch(answer: { status: number; body?: string } | Error): {
  fetch: SafeFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: SafeFetch = (url, options) => {
    calls.push({ url, options });
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      status: answer.status,
      headers: {},
      body: answer.body ?? '',
      url,
      bytes: 0,
      durationMs: 1,
      redirects: 0,
    });
  };
  return { fetch, calls };
}

async function failure(promise: Promise<unknown>): Promise<NotifierError> {
  const error = await promise.then(
    () => new Error('expected a failure'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(NotifierError);
  return error as NotifierError;
}

describe('Discord channel', () => {
  it('posts one embed with no allowed mentions through safeFetch', async () => {
    const { fetch, calls } = fakeFetch({ status: 204 });
    await discordChannel(WEBHOOK, fetch).send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(WEBHOOK);
    const body = JSON.parse(calls[0]?.options?.json ?? '{}') as Record<string, unknown>;
    expect(body['allowed_mentions']).toEqual({ parse: [] });
    expect(calls[0]?.options?.trust).toBe('default');
  });

  it('fails on a non-2xx answer without leaking the webhook URL', async () => {
    const { fetch } = fakeFetch({ status: 429 });
    const error = await failure(discordChannel(WEBHOOK, fetch).send(message));
    expect(error.message).toBe('discord: HTTP 429');
    expect(error.message).not.toContain('webhooks');
  });

  it('reports network errors by code only', async () => {
    const { fetch } = fakeFetch(new SafeFetchError('TIMEOUT', `timeout on ${WEBHOOK}`));
    const error = await failure(discordChannel(WEBHOOK, fetch).send(message));
    expect(error.message).toBe('discord: TIMEOUT');
    expect(error.cause).toBeUndefined();
  });
});

describe('Telegram channel', () => {
  it('calls sendMessage in HTML mode and checks the ok flag', async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: '{"ok":true,"result":{}}' });
    await telegramChannel(TOKEN, '-1001234', fetch).send(message);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = JSON.parse(calls[0]?.options?.json ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: '-1001234', parse_mode: 'HTML' });
    expect(String(body['text'])).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('treats ok:false or invalid JSON as a failure', async () => {
    for (const body of ['{"ok":false}', 'not json']) {
      const { fetch } = fakeFetch({ status: 200, body });
      await failure(telegramChannel(TOKEN, '1', fetch).send(message));
    }
  });

  it('never puts the bot token in an error', async () => {
    const { fetch } = fakeFetch({ status: 401 });
    const error = await failure(telegramChannel(TOKEN, '1', fetch).send(message));
    expect(error.message).toBe('telegram: HTTP 401');
    expect(error.message).not.toContain(TOKEN);
    const network = fakeFetch(new Error(`connect failed for ${TOKEN}`));
    const other = await failure(telegramChannel(TOKEN, '1', network.fetch).send(message));
    expect(other.message).toBe('telegram: NETWORK_ERROR');
  });
});

describe('configuration', () => {
  it('accepts only genuine Discord webhook URLs', () => {
    expect(isDiscordWebhook(WEBHOOK)).toBe(true);
    expect(isDiscordWebhook(WEBHOOK.replace('discord.com', 'discordapp.com'))).toBe(true);
    expect(isDiscordWebhook(WEBHOOK.replace('https:', 'http:'))).toBe(false);
    expect(isDiscordWebhook(WEBHOOK.replace('discord.com', 'discord.com.evil.example'))).toBe(
      false,
    );
    expect(isDiscordWebhook(WEBHOOK.replace('discord.com', 'discord.com:8443'))).toBe(false);
    expect(isDiscordWebhook(WEBHOOK.replace('https://', 'https://user:pass@'))).toBe(false);
    expect(isDiscordWebhook('https://discord.com/api/users/@me')).toBe(false);
    expect(isDiscordWebhook('not a url')).toBe(false);
  });

  it('validates Telegram tokens and chat ids', () => {
    expect(isTelegramToken(TOKEN)).toBe(true);
    expect(isTelegramToken('123:short')).toBe(false);
    expect(isTelegramToken(`${TOKEN}/../x`)).toBe(false);
    expect(isTelegramChatId('-1001234')).toBe(true);
    expect(isTelegramChatId('@panel_alerts')).toBe(true);
    expect(isTelegramChatId('1; drop')).toBe(false);
  });

  it('builds the configured channels and reports malformed settings by name', () => {
    const { fetch } = fakeFetch({ status: 204 });
    expect(createChannels({}, fetch)).toEqual({ channels: [], invalid: [] });
    const both = createChannels(
      { discordWebhookUrl: WEBHOOK, telegramBotToken: TOKEN, telegramChatId: '42' },
      fetch,
    );
    expect(both.channels.map((c) => c.name)).toEqual(['discord', 'telegram']);
    expect(
      createChannels(
        { discordWebhookUrl: 'https://evil.example/hook', telegramBotToken: TOKEN },
        fetch,
      ),
    ).toEqual({ channels: [], invalid: ['DISCORD_WEBHOOK_URL', 'TELEGRAM_CHAT_ID'] });
    expect(createChannels({ telegramChatId: '42' }, fetch).invalid).toEqual(['TELEGRAM_BOT_TOKEN']);
  });
});
