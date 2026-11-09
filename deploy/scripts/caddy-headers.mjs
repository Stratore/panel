// Prints the Caddyfile snippet with the security headers of SPEC § 9.2, from the single
// definition in packages/shared (build it first). Used by the web image build.
import { caddyHeadersSnippet } from '../../packages/shared/dist/csp.js';

process.stdout.write(caddyHeadersSnippet());
