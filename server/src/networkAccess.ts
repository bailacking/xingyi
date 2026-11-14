import os from 'node:os';
import { isIPv4 } from 'node:net';

type RequestHeaders = { host?: string; origin?: string; 'sec-fetch-site'?: string };

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function requestHost(headers: RequestHeaders): URL | null {
  if (!headers.host || !/^(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d+)?$/i.test(headers.host)) return null;
  try {
    return new URL(`http://${headers.host}`);
  } catch {
    return null;
  }
}

export function isLocalRequest(ip: string, headers: RequestHeaders): boolean {
  const host = requestHost(headers);
  return host !== null && loopbackHosts.has(host.hostname) && isLoopback(ip);
}

export function isLanPeer(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const address = ip.replace(/^::ffff:/, '');
  if (!isIPv4(address)) return false;
  const octets = address.split('.').map(Number);
  return Object.values(os.networkInterfaces()).some((list) => list?.some((entry) => {
    if (entry.family !== 'IPv4' || entry.internal) return false;
    const subnet = entry.address.split('.').map(Number);
    return entry.netmask.split('.').map(Number).every((mask, i) => (subnet[i]! & mask) === (octets[i]! & mask));
  }));
}

export function isSameSiteRequest(headers: RequestHeaders): boolean {
  const host = requestHost(headers);
  if (!host || headers['sec-fetch-site'] === 'cross-site') return false;
  const allowed = loopbackHosts.has(host.hostname) || host.hostname === os.hostname().toLowerCase() ||
    Object.values(os.networkInterfaces()).some((list) =>
      list?.some(({ address }) => address === host.hostname || `[${address}]` === host.hostname),
    );
  if (!allowed) return false;
  if (!headers.origin) return true;
  return headers.origin === host.origin;
}
