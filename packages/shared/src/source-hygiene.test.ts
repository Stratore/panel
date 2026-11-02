import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * "Trojan Source" guard: invisible, bidi-override and control characters must never appear
 * literally in source code, where they can make code read differently than it runs.
 * Use escapes instead. Code points are listed numerically so this file stays clean itself.
 */
const FORBIDDEN_RANGES: readonly [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0xa0],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', 'design-reference']);
const EXTENSIONS = ['.ts', '.js', '.json', '.css', '.html', '.yml', '.yaml', '.sql'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

describe('source hygiene', () => {
  it('contains no literal invisible or bidi control characters', () => {
    const offenders: string[] = [];
    for (const dir of ['apps', 'packages', 'config', '.github']) {
      for (const file of walk(join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8');
        for (const char of text) {
          const cp = char.codePointAt(0) ?? 0;
          if (FORBIDDEN_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) {
            offenders.push(
              `${file.slice(ROOT.length)}: U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
            );
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
