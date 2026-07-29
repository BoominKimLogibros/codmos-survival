import { networkInterfaces } from 'node:os';

interface NetworkAddressInfo {
  address: string;
  netmask: string;
  family: string | number;
  internal: boolean;
}

type NetworkInterfaceMap = Record<string, readonly NetworkAddressInfo[] | undefined>;

function ipv4ToUint32(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = ((result * 256) + octet) >>> 0;
  }
  return result;
}

function uint32ToIpv4(value: number): string {
  return [24, 16, 8, 0]
    .map((shift) => String((value >>> shift) & 0xff))
    .join('.');
}

export function calculateDirectedBroadcastAddress(address: string, netmask: string): string | null {
  const ip = ipv4ToUint32(address);
  const mask = ipv4ToUint32(netmask);
  if (ip === null || mask === null || mask === 0 || mask === 0xffffffff) return null;
  const broadcast = ((ip & mask) | (~mask >>> 0)) >>> 0;
  if (broadcast === ip) return null;
  return uint32ToIpv4(broadcast);
}

export function getLanBroadcastAddresses(
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isIpv4 || entry.internal) continue;
      const broadcast = calculateDirectedBroadcastAddress(entry.address, entry.netmask);
      if (broadcast) addresses.add(broadcast);
    }
  }
  return [...addresses].sort();
}
