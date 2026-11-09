import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/panel.db'),
  PANEL_PUBLIC_URL: optional.pipe(z.url({ protocol: /^https?$/ }).optional()),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SETUP_TOKEN: optional,
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DISCORD_WEBHOOK_URL: optional,
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
});

export interface ApiConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databasePath: string;
  /** Origin allowed on state-changing requests, e.g. https://panel.example.ts.net. */
  publicOrigin: string | undefined;
  sessionSecret: string;
  /** One-time token required by /api/auth/setup; generated (and logged) when not provided. */
  setupToken: string;
  setupTokenGenerated: boolean;
  trustProxy: boolean;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  channels: { discord: boolean; telegram: boolean };
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.parse(env);
  const pkg = z
    .object({ version: z.string() })
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the app's own package.json
    .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
  const generated = parsed.SETUP_TOKEN === undefined;
  return {
    env: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: resolve(parsed.DATABASE_PATH),
    publicOrigin:
      parsed.PANEL_PUBLIC_URL === undefined ? undefined : new URL(parsed.PANEL_PUBLIC_URL).origin,
    sessionSecret: parsed.SESSION_SECRET,
    setupToken: parsed.SETUP_TOKEN ?? randomBytes(24).toString('base64url'),
    setupTokenGenerated: generated,
    trustProxy: parsed.TRUST_PROXY,
    logLevel: parsed.LOG_LEVEL,
    channels: {
      discord: parsed.DISCORD_WEBHOOK_URL !== undefined,
      telegram: parsed.TELEGRAM_BOT_TOKEN !== undefined && parsed.TELEGRAM_CHAT_ID !== undefined,
    },
    version: pkg.version,
  };
}
