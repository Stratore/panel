// Container healthcheck. Distroless images have no shell, curl or wget, so Node does it.
//   node healthcheck.mjs http http://127.0.0.1:3000/api/health/live
//   node healthcheck.mjs file /tmp/collector.alive 180
// Exit 0 when healthy, 1 otherwise.
import { statSync } from 'node:fs';
// Loopback-only probe of the container's own port, never an outbound request: safeFetch
// would (rightly) refuse 127.0.0.1.
// eslint-disable-next-line no-restricted-imports
import { get } from 'node:http';

const [mode, target = '', maxAgeSeconds = '180'] = process.argv.slice(2);

if (mode === 'file') {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path from the compose file
    const age = Date.now() - statSync(target).mtimeMs;
    process.exit(age < Number(maxAgeSeconds) * 1000 ? 0 : 1);
  } catch {
    process.exit(1);
  }
} else if (mode === 'http' && target.startsWith('http://127.0.0.1:')) {
  const request = get(target, { timeout: 3000 }, (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  });
  request.on('timeout', () => request.destroy());
  request.on('error', () => process.exit(1));
} else {
  process.exit(1);
}
