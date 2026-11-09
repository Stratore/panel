import { defineConfig, type Plugin } from 'vite';
// Relative import: the config is bundled by Vite and must not depend on a prior build.
import { SECURITY_HEADERS } from '../../packages/shared/src/csp.js';

const API = process.env['PANEL_API_URL'] ?? 'http://127.0.0.1:3000';

/**
 * Preloads the two most used interface weights (SPEC § 10). Their hashed file names are only
 * known once the bundle exists, so the tags are injected at build time.
 */
function preloadFonts(): Plugin {
  return {
    name: 'panel-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((name) =>
          /hanken-grotesk-latin-(500|600)-normal-[\w-]+\.woff2$/.test(name),
        );
        return files.map((file) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `/${file}`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
          },
          injectTo: 'head',
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [preloadFonts()],
  build: {
    target: 'es2022',
    // Never inline assets as data: URIs (fonts would violate font-src 'self').
    assetsInlineLimit: 0,
    // Modern browsers only: no polyfill script.
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: {
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
  // `vite preview` serves the production build with the production headers, which is how the
  // CSP and Trusted Types are verified before Caddy exists (Phase 9).
  preview: {
    headers: SECURITY_HEADERS,
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
});
