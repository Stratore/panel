/**
 * Rough passphrase strength for the setup meter (0–4). It only guides the user: the server
 * enforces the real rule (12 characters minimum) and hashes with Argon2id.
 */
export function passphraseStrength(value: string, min = 12): 0 | 1 | 2 | 3 | 4 {
  // UTF-16 length, like the server-side Zod rule.
  const length = value.length;
  if (length < min) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((re) => re.test(value)).length;
  const unique = new Set(value.toLowerCase()).size;
  if (unique < 6) return 1;
  let score = 1;
  if (length >= 16) score++;
  if (length >= 24) score++;
  if (classes >= 3) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
