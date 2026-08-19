/**
 * SSRF 防护与 DNS IP Pinning
 * - 解析后校验 IP
 * - 请求时通过 custom lookup 固定已校验地址，避免 DNS rebinding
 */
import dns from 'dns/promises';
import net from 'net';

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata'
]);

export function normalizeIp(ip) {
  const value = String(ip || '').toLowerCase();
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidrV4(ip, base, prefix) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function parseIpv6ToBigInt(ip) {
  const normalized = normalizeIp(ip).toLowerCase();
  if (normalized.includes('.')) {
    // Should already be unmapped by normalizeIp for ::ffff:x.x.x.x
    return null;
  }

  let head = normalized;
  let tail = '';
  if (normalized.includes('::')) {
    const parts = normalized.split('::');
    if (parts.length > 2) return null;
    head = parts[0];
    tail = parts[1] || '';
  }

  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  if (headParts.length + tailParts.length > 8) return null;

  const mid = Array(8 - headParts.length - tailParts.length).fill('0');
  const full = [...headParts, ...mid, ...tailParts].map((p) => p || '0');
  if (full.length !== 8) return null;

  let value = 0n;
  for (const part of full) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    value = (value << 16n) + BigInt(parseInt(part, 16));
  }
  return value;
}

function inCidrV6(ip, base, prefix) {
  const ipVal = parseIpv6ToBigInt(ip);
  const baseVal = parseIpv6ToBigInt(base);
  if (ipVal === null || baseVal === null) return false;
  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return (ipVal >> shift) === (baseVal >> shift);
}

export function isBlockedIp(ip) {
  const normalized = normalizeIp(ip);
  const version = net.isIP(normalized);
  if (!version) return true;

  if (version === 4) {
    return (
      inCidrV4(normalized, '0.0.0.0', 8) ||
      inCidrV4(normalized, '10.0.0.0', 8) ||
      inCidrV4(normalized, '100.64.0.0', 10) ||
      inCidrV4(normalized, '127.0.0.0', 8) ||
      inCidrV4(normalized, '169.254.0.0', 16) ||
      inCidrV4(normalized, '172.16.0.0', 12) ||
      inCidrV4(normalized, '192.168.0.0', 16) ||
      inCidrV4(normalized, '224.0.0.0', 4) ||
      inCidrV4(normalized, '240.0.0.0', 4)
    );
  }

  // IPv6
  return (
    inCidrV6(normalized, '::', 128) ||
    inCidrV6(normalized, '::1', 128) ||
    inCidrV6(normalized, 'fc00::', 7) ||
    inCidrV6(normalized, 'fe80::', 10) ||
    inCidrV6(normalized, 'ff00::', 8) ||
    // IPv4-mapped already normalized; also block explicitly if still mapped form slips through
    normalized.startsWith('::ffff:')
  );
}

/**
 * @returns {Promise<{ok:true,url:string,hostname:string,address:string,family:number}|{ok:false,error:string}>}
 */
export async function validateProbeTarget(rawUrl, { maxLength = MAX_URL_LENGTH } = {}) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > maxLength) {
    return { ok: false, error: 'INVALID_URL' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'INVALID_PROTOCOL' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { ok: false, error: 'BLOCKED_HOST' };
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { ok: false, error: 'BLOCKED_IP' };
    }
    const family = net.isIP(hostname);
    return {
      ok: true,
      url: parsed.href,
      hostname,
      address: hostname,
      family
    };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: 'DNS_FAILED' };
  }

  if (!addresses.length) {
    return { ok: false, error: 'DNS_FAILED' };
  }

  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      return { ok: false, error: 'BLOCKED_IP' };
    }
  }

  const primary = addresses[0];
  return {
    ok: true,
    url: parsed.href,
    hostname,
    address: primary.address,
    family: primary.family
  };
}

/** 供 http.request / https.request 使用的 pinned lookup */
export function createPinnedLookup(address, family) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const fam = family || (net.isIP(address) === 6 ? 6 : 4);
    // Node lookup callback: (err, address, family) or all:true form
    if (options && typeof options === 'object' && options.all) {
      cb(null, [{ address, family: fam }]);
      return;
    }
    cb(null, address, fam);
  };
}
