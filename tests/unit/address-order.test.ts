import { describe, expect, it } from 'vitest';
import { resolvePublicAddress, resolvePublicAddresses } from '../../packages/core/net/safe-fetch.ts';

const resolver = (answers: string[]) => async () => answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('public address resolution order', () => {
  it('returns IPv4 answers first even when the resolver lists IPv6 first', async () => {
    const r = resolver(['2606:4700:3033::ac43:acce', '172.67.172.206', '2606:4700:3037::6815:2fd7', '104.21.47.215']);
    expect(await resolvePublicAddresses('preview.example', 443, { resolver: r })).toEqual(['172.67.172.206', '104.21.47.215', '2606:4700:3033::ac43:acce', '2606:4700:3037::6815:2fd7']);
    expect(await resolvePublicAddress('preview.example', 443, { resolver: r })).toBe('172.67.172.206');
  });
  it('still rejects the whole name if any answer is private, in either family', async () => {
    await expect(resolvePublicAddresses('x', 443, { resolver: resolver(['1.1.1.1', '10.0.0.5']) })).rejects.toThrow(/non_public/);
    await expect(resolvePublicAddresses('x', 443, { resolver: resolver(['1.1.1.1', 'fd00::1']) })).rejects.toThrow(/non_public/);
    await expect(resolvePublicAddresses('x', 443, { resolver: resolver(['169.254.169.254']) })).rejects.toThrow(/non_public/);
  });
  it('keeps IPv6-only names working', async () => {
    expect(await resolvePublicAddresses('x', 443, { resolver: resolver(['2606:4700::1']) })).toEqual(['2606:4700::1']);
  });
});
