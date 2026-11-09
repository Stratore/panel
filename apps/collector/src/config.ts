import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

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
  NVD_API_KEY: optionalSecret,
  GITHUB_TOKEN: optionalSecret,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface CollectorConfig {
  databasePath: string;
  sourcesPath: string;
  keywordsPath: string;
  backupDir: string | undefined;
  secrets: { nvdApiKey: string | undefined; githubToken: string | undefined };
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
    secrets: { nvdApiKey: parsed.NVD_API_KEY, githubToken: parsed.GITHUB_TOKEN },
    logLevel: parsed.LOG_LEVEL,
    userAgent: `Panel/${pkg.version} (+https://github.com/Stratore/panel)`,
  };
}
