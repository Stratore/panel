import { nvdAdapter } from './nvd.js';
import { rssAdapter } from './rss.js';
import { epssAdapter, ghsaAdapter, hibpAdapter, kevAdapter } from './security.js';
import { createHnAdapter, devtoAdapter, ghTrendingAdapter, lobstersAdapter } from './tech.js';
import type { AdapterId, SourceAdapter } from './types.js';

export type AdapterRegistry = Readonly<Record<AdapterId, SourceAdapter>>;

export function createAdapters(): AdapterRegistry {
  return {
    rss: rssAdapter,
    'cisa-kev': kevAdapter,
    nvd: nvdAdapter,
    epss: epssAdapter,
    ghsa: ghsaAdapter,
    hibp: hibpAdapter,
    hn: createHnAdapter(),
    lobsters: lobstersAdapter,
    devto: devtoAdapter,
    'gh-trending': ghTrendingAdapter,
  };
}

export * from './types.js';
