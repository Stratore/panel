# Security policy

Panel is a self-hosted, single-user application that ingests untrusted content from the web. Security reports are welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository, then **Report a vulnerability**.

Include the affected version or commit, reproduction steps and the impact you observed. You can expect an acknowledgement within 7 days.

## Scope

In scope: the API, the collector (feed parsing, SSRF protections in `packages/safe-fetch`), the front-end, and the provided Docker/Caddy configuration.

Out of scope: vulnerabilities in third-party sources, and deployments that deviate from the documented configuration (for example, exposing the instance to the public Internet without Tailscale).

The threat model is documented in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).
