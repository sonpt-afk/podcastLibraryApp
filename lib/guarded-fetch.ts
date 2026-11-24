import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { IncomingMessage } from 'node:http';

// SPEC §10: the ONLY way this app touches the internet on behalf of a user-supplied URL.

export class GuardedFetchError extends Error {
  constructor(
    public code:
      | 'bad_url' | 'blocked_address' | 'dns' | 'timeout' | 'too_large'
      | 'bad_content_type' | 'too_many_redirects' | 'http_status' | 'network',
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

// Everything that is not a normal public unicast address.
const blocked = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64],
] as const) blocked.addSubnet(net6, bits, 'ipv6');

/** True if `ip` must never be fetched (private, loopback, link-local, metadata, multicast, ...). */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family !== 6) return true; // not an IP literal: refuse
  // URL normalises every textual form (::ffff:127.0.0.1, 0:0:0:0:0:ffff:7f00:1, ...) to compressed hex.
  const h = new URL(`http://[${ip}]`).hostname.slice(1, -1).toLowerCase();
  const embedded =
    h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? // IPv4-mapped
    h.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? // NAT64
    h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/); // 6to4
  if (embedded) {
    const a = parseInt(embedded[1], 16);
    const b = parseInt(embedded[2], 16);
    return isBlockedIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  }
  return blocked.check(h, 'ipv6');
}

// Validation and connection use the SAME lookup result, so DNS rebinding can't swap the IP in between.
const safeLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '', 0);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || list.length === 0) {
      return cb(new GuardedFetchError('blocked_address', `Blocked address for ${hostname}`) as never, '', 0);
    }
    if (options.all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

export interface GuardedFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allowed response content types; default accepts XML/text/JSON. */
  contentType?: RegExp;
  headers?: Record<string, string>;
}

export interface GuardedResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  stream: NodeJS.ReadableStream;
  destroy: () => void;
}

/** One HTTPS request, no redirect following. Replaceable in tests. */
export type RequestOnce = (url: URL, headers: Record<string, string>, timeoutMs: number) => Promise<RawResponse>;

const requestOnce: RequestOnce = (url, headers, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers, lookup: safeLookup, timeout: timeoutMs },
      (res: IncomingMessage) =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res, destroy: () => res.destroy() }),
    );
    req.on('timeout', () => req.destroy(new GuardedFetchError('timeout', 'Request timed out')));
    req.on('error', (e) => reject(e instanceof GuardedFetchError ? e : classify(e)));
    req.end();
  });

function classify(e: Error & { code?: string }): GuardedFetchError {
  if (e instanceof GuardedFetchError) return e;
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return new GuardedFetchError('dns', `DNS lookup failed: ${e.message}`);
  return new GuardedFetchError('network', e.message);
}

export async function guardedFetch(
  input: string,
  opts: GuardedFetchOptions = {},
  request: RequestOnce = requestOnce,
): Promise<GuardedResponse> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const typeOk = opts.contentType ?? /xml|text\/|json/i;
  const deadline = Date.now() + timeoutMs;

  let url = parse(input);
  for (let hop = 0; ; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new GuardedFetchError('timeout', 'Request timed out');
    // An IP literal skips DNS (and therefore our lookup hook), so check it up front.
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedIp(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new GuardedFetchError('blocked_address', `Blocked address ${url.hostname}`);
    }
    const res = await request(url, { 'accept-encoding': 'gzip', 'user-agent': 'PodcastEbookBot/0.1', ...opts.headers }, left);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      res.destroy();
      if (hop >= maxRedirects) throw new GuardedFetchError('too_many_redirects', 'Too many redirects');
      const loc = res.headers.location;
      if (typeof loc !== 'string') throw new GuardedFetchError('http_status', 'Redirect without Location', res.status);
      url = parse(new URL(loc, url).toString()); // re-validated: https only, IP check on next hop
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.destroy();
      throw new GuardedFetchError('http_status', `HTTP ${res.status}`, res.status);
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (!typeOk.test(contentType)) {
      res.destroy();
      throw new GuardedFetchError('bad_content_type', `Unexpected content-type: ${contentType || 'none'}`);
    }
    const body = await readCapped(res, maxBytes, left);
    return { url: url.toString(), status: res.status, contentType, body };
  }
}

function parse(input: string): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new GuardedFetchError('bad_url', 'Invalid URL');
  }
  if (u.protocol !== 'https:') throw new GuardedFetchError('bad_url', 'Only https URLs are allowed');
  if (u.username || u.password) throw new GuardedFetchError('bad_url', 'Credentials in URL are not allowed');
  return u;
}

function readCapped(res: RawResponse, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const src: NodeJS.ReadableStream =
      enc === 'gzip' ? res.stream.pipe(zlib.createGunzip()) : res.stream; // cap applies AFTER decompression (zip bombs)
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => fail(new GuardedFetchError('timeout', 'Request timed out')), timeoutMs);
    const fail = (e: Error) => {
      clearTimeout(timer);
      res.destroy();
      reject(e instanceof GuardedFetchError ? e : classify(e));
    };
    src.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) return fail(new GuardedFetchError('too_large', `Response exceeds ${maxBytes} bytes`));
      chunks.push(c);
    });
    src.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    src.on('error', fail);
  });
}
