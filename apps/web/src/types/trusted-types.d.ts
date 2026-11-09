// Minimal Trusted Types declarations (not yet in TypeScript's DOM lib): only what main.ts uses.

interface TrustedScriptURL {
  toString(): string;
}

interface TrustedTypePolicy {
  createScriptURL(input: string): TrustedScriptURL;
}

interface TrustedTypePolicyFactory {
  createPolicy(
    name: string,
    rules: { createScriptURL?: (input: string) => string },
  ): TrustedTypePolicy;
}

interface Window {
  readonly trustedTypes?: TrustedTypePolicyFactory;
}
