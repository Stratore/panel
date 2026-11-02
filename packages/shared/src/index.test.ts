import { describe, expect, it } from 'vitest';
import { APP_NAME, CATEGORIES } from './index.js';

describe('shared constants', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('Panel');
  });

  it('lists the five Journal categories', () => {
    expect(CATEGORIES).toEqual(['ai', 'cyber', 'innovation', 'dev', 'hardware']);
  });
});
