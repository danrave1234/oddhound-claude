// SSRF address policy: decides whether an IP address may be dialled on behalf of a scan.
// Applied to the address actually connected to (after DNS), never to a hostname string.

import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
const v4 = (cidr: string) => { const [a, p] = cidr.split('/'); blocked.addSubnet(a!, Number(p), 'ipv4'); };
const v6 = (cidr: string) => { const [a, p] = cidr.split('/'); blocked.addSubnet(a!, Number(p), 'ipv6'); };

// IPv4 special-purpose and non-global ranges (IANA special-purpose registry).
[
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
].forEach(v4);
// IPv6 special-purpose ranges. fc00::/7 covers ULA, including Fly's fdaa:: private network.
[
  '::/128', '::1/128', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16',
  'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
].forEach(v6);

export type AddressVerdict = { allowed: true } | { allowed: false; reason: string };

/** Extract an embedded IPv4 address from IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) forms. */
function embeddedIPv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower) ?? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return mapped[1];
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (nat64) return nat64[1];
  return undefined;
}

export function classifyAddress(address: string): AddressVerdict {
  const family = isIP(address);
  if (family === 0) return { allowed: false, reason: 'not_an_ip_address' };
  if (family === 6) {
    const inner = embeddedIPv4(address);
    if (inner) return { allowed: false, reason: 'ipv4_embedded_in_ipv6' };
    if (address.toLowerCase().startsWith('64:ff9b:')) return { allowed: false, reason: 'nat64_prefix' };
    if (blocked.check(address, 'ipv6')) return { allowed: false, reason: 'non_public_ipv6' };
    return { allowed: true };
  }
  if (blocked.check(address, 'ipv4')) return { allowed: false, reason: 'non_public_ipv4' };
  return { allowed: true };
}

/**
 * A lab profile lists exact address:port pairs that a local, non-public demo target may use.
 * It is configured by the operator for the local lab only; it is never derived from user input
 * and never enabled in hosted mode.
 */
export type LabProfile = { allowedEndpoints: ReadonlySet<string> };

export function endpointKey(address: string, port: number): string {
  return isIP(address) === 6 ? `[${address.toLowerCase()}]:${port}` : `${address}:${port}`;
}

export function isDialAllowed(address: string, port: number, lab?: LabProfile): AddressVerdict {
  if (lab?.allowedEndpoints.has(endpointKey(address, port))) return { allowed: true };
  const verdict = classifyAddress(address);
  if (!verdict.allowed) return verdict;
  if (port !== 443 && port !== 80) return { allowed: false, reason: 'port_not_allowed' };
  return { allowed: true };
}

export function labProfileFromEnv(env: NodeJS.ProcessEnv = process.env): LabProfile | undefined {
  if (env.ODDHOUND_LAB_MODE !== '1') return undefined;
  if (env.NODE_ENV === 'production') return undefined;
  const list = (env.ODDHOUND_LAB_ENDPOINTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { allowedEndpoints: new Set(list) };
}
