import { describe, expect, it } from 'vitest';
import { isPublicAddress, parseCidrList } from './ip.js';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.215.14',
    '2606:4700:4700::1111',
    '2a00:1450:4007:80e::200e',
    '[2606:4700:4700::1111]',
  ])('allows public unicast %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    // SPEC § 9.3 IPv4 ranges
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', '0/8'],
    ['10.1.2.3', 'private 10/8'],
    ['100.64.0.1', 'CGNAT'],
    ['100.100.100.100', 'Tailscale MagicDNS'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback range'],
    ['169.254.169.254', 'cloud metadata'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.17.0.1', 'Docker bridge'],
    ['172.31.255.255', 'private 172.16/12 end'],
    ['192.0.0.8', '192.0.0/24'],
    ['192.168.1.1', 'private 192.168/16'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.2.1', 'documentation'],
    // IPv6
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['[::1]', 'bracketed loopback'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    // IPv4 smuggled inside IPv6
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['2002:7f00:1::1', '6to4 loopback'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    // Garbage
    ['', 'empty'],
    ['localhost', 'hostname'],
    ['999.1.1.1', 'invalid'],
    ['fe80::1%eth0', 'zone id'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('honours extra blocked ranges (e.g. a custom Docker network)', () => {
    const extra = parseCidrList(['8.8.8.0/24', '2606:4700::/32']);
    expect(isPublicAddress('8.8.8.8', extra)).toBe(false);
    expect(isPublicAddress('2606:4700:4700::1111', extra)).toBe(false);
    expect(isPublicAddress('1.1.1.1', extra)).toBe(true);
  });
});
