import { eq } from 'drizzle-orm';
import { DEFAULT_PREFS, prefsSchema, type Prefs } from '@panel/shared';
import type { PanelDb } from './client.js';
import { prefs } from './schema.js';

/** Instance preferences; anything missing or invalid falls back to the defaults. */
export function readPrefs(db: PanelDb): Prefs {
  const parsed = prefsSchema.safeParse(
    db.select().from(prefs).where(eq(prefs.key, 'prefs')).get()?.valueJson,
  );
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}
