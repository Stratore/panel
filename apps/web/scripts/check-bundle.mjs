// Performance budget (SPEC § 10): initial JavaScript under 60 KB gzipped, and no validation
// library in the browser (the shared contract is imported as types only, ADR-031).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const BUDGET = 60 * 1024;
const assets = new URL('../dist/assets/', import.meta.url);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the build's own output directory
const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));

let failed = false;
for (const name of scripts) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- listed from the build output above
  const source = readFileSync(join(assets.pathname.replace(/^\/([A-Za-z]:)/, '$1'), name));
  const size = gzipSync(source).length;
  const text = source.toString('utf8');
  console.log(`${name}: ${(size / 1024).toFixed(1)} KB gzipped`);
  if (size > BUDGET) {
    console.error(`  over the ${String(BUDGET / 1024)} KB budget`);
    failed = true;
  }
  if (text.includes('_zod') || text.includes('ZodError')) {
    console.error('  contains Zod: import shared constants from a Zod-free module');
    failed = true;
  }
}
if (failed) process.exit(1);
