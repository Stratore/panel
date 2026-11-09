import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { systemTimeZone, type ChannelSecrets } from '@panel/notifier';

/** Empty strings in .env mean "not set". */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const envSchema = z.object({
  DATABASE_PATH: z.string().min(1).default('./data/panel.db'),
  SOURCES_PATH: z.string().min(1).default('./config/sources.default.json'),
  KEYWORDS_PATH: z.string().min(1).default('./config/keywords.json'),
  BACKUP_DIR: optionalSecret,
  HEARTBEAT_FILE: optionalSecret,
  NVD_API_KEY: optionalSecret,
  GITHUB_TOKEN: optionalSecret,
  DISCORD_WEBHOOK_URL: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_CHAT_ID: optionalSecret,
  PANEL_PUBLIC_URL: optionalSecret.pipe(z.url({ protocol: /^https?$/ }).optional()),
  TZ: optionalSecret.refine(
    (tz) => tz === undefined || isTimeZone(tz),
    'TZ must be an IANA time zone such as Europe/Paris',
  ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface CollectorConfig {
  databasePath: string;
  sourcesPath: string;
  keywordsPath: string;
  backupDir: string | undefined;
  /** Touched every minute; the container healthcheck reads its age. */
  heartbeatFile: string | undefined;
  secrets: { nvdApiKey: string | undefined; githubToken: string | undefined };
  /** Notifier channels (SPEC § 7.10); never logged. */
  alertSecrets: ChannelSecrets;
  /** Origin used in alert links, e.g. https://panel.example.ts.net. */
  publicUrl: string | undefined;
  /** Time zone for quiet hours and the digest. */
  timeZone: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  userAgent: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = envSchema.parse(env);
  const pkg = z
    .object({ version: z.string() })
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the app's own package.json
    .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
  return {
    databasePath: resolve(parsed.DATABASE_PATH),
    sourcesPath: resolve(parsed.SOURCES_PATH),
    keywordsPath: resolve(parsed.KEYWORDS_PATH),
    backupDir: parsed.BACKUP_DIR === undefined ? undefined : resolve(parsed.BACKUP_DIR),
    heartbeatFile: parsed.HEARTBEAT_FILE === undefined ? undefined : resolve(parsed.HEARTBEAT_FILE),
    secrets: { nvdApiKey: parsed.NVD_API_KEY, githubToken: parsed.GITHUB_TOKEN },
    alertSecrets: {
      discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL,
      telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
      telegramChatId: parsed.TELEGRAM_CHAT_ID,
    },
    publicUrl:
      parsed.PANEL_PUBLIC_URL === undefined ? undefined : new URL(parsed.PANEL_PUBLIC_URL).origin,
    timeZone: parsed.TZ ?? systemTimeZone(),
    logLevel: parsed.LOG_LEVEL,
    userAgent: `Panel/${pkg.version} (+https://github.com/Stratore/panel)`,
  };
}
