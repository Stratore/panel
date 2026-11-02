import ipaddr from 'ipaddr.js';

/**
 * Ranges that must never be reached (SPEC § 9.3), checked in addition to ipaddr.js's own
 * classification. IPv4-mapped IPv6 addresses are unwrapped first, so ::ffff:127.0.0.1 is
 * judged as 127.0.0.1.
 */
const BLOCKED_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10', // CGNAT, used by Tailscale
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local, cloud metadata
  '172.16.0.0/12', // includes Docker's default bridge networks
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  '::ffff:0:0/96',
  '64:ff9b::/96', // NAT64: embeds an IPv4 address
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/32', // Teredo
  '2001:db8::/32',
  '2002::/16', // 6to4: embeds an IPv4 address
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
].map((cidr) => ipaddr.parseCIDR(cidr));

export type ParsedCidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

export function parseCidrList(list: readonly string[]): ParsedCidr[] {
  return list.map((cidr) => ipaddr.parseCIDR(cidr));
}

function inAny(address: ipaddr.IPv4 | ipaddr.IPv6, ranges: readonly ParsedCidr[]): boolean {
  return ranges.some(
    ([network, bits]) => address.kind() === network.kind() && address.match(network, bits),
  );
}

/**
 * True only for globally routable unicast addresses. Anything unparsable, private, reserved,
 * special-purpose, or in `extraBlocked` (e.g. a custom Docker network) is refused.
 */
export function isPublicAddress(ip: string, extraBlocked: readonly ParsedCidr[] = []): boolean {
  const literal = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (!ipaddr.isValid(literal)) return false;
  // process() unwraps IPv4-mapped IPv6; zone ids (fe80::1%eth0) are rejected by isValid's parser.
  const address = ipaddr.process(literal);
  if (address.range() !== 'unicast') return false;
  return !inAny(address, BLOCKED_CIDRS) && !inAny(address, extraBlocked);
}
