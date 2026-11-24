import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { guardedFetch, GuardedFetchError, isBlockedIp, type RequestOnce } from './guarded-fetch';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '64:ff9b::7f00:1', '2002:7f00:1::',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );

  it('refuses non-IP input', () => expect(isBlockedIp('localhost')).toBe(true));
});

const reply = (
  status: number,
  headers: Record<string, string>,
  body: Buffer | string = '',
): ReturnType<RequestOnce> =>
  Promise.resolve({
    status,
    headers,
    stream: Readable.from([Buffer.from(body)]),
    destroy: () => {},
  });

const xml = { 'content-type': 'application/rss+xml' };

describe('guardedFetch', () => {
  it.each(['http://example.com/feed', 'ftp://example.com/x', 'file:///etc/passwd', 'not a url', 'https://user:pw@example.com/'])(
    'rejects url %s before any request',
    async (u) => {
      let called = false;
      const req: RequestOnce = () => ((called = true), reply(200, xml));
      await expect(guardedFetch(u, {}, req)).rejects.toMatchObject({ code: 'bad_url' });
      expect(called).toBe(false);
    },
  );

  it.each(['https://127.0.0.1/feed', 'https://[::1]/feed', 'https://169.254.169.254/latest/meta-data', 'https://2130706433/x'])(
    'rejects IP-literal %s',
    async (u) => {
      const req: RequestOnce = () => reply(200, xml);
      await expect(guardedFetch(u, {}, req)).rejects.toMatchObject({ code: 'blocked_address' });
    },
  );

  it('returns body on 200', async () => {
    const res = await guardedFetch('https://example.com/feed', {}, () => reply(200, xml, '<rss/>'));
    expect(res.body.toString()).toBe('<rss/>');
  });

  it('follows redirects and re-checks the target', async () => {
    const req: RequestOnce = (url) =>
      url.hostname === 'example.com'
        ? reply(302, { location: 'https://169.254.169.254/' })
        : reply(200, xml, 'secret');
    await expect(guardedFetch('https://example.com/a', {}, req)).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('rejects redirect to http', async () => {
    const req: RequestOnce = () => reply(301, { location: 'http://example.com/' });
    await expect(guardedFetch('https://example.com/a', {}, req)).rejects.toMatchObject({ code: 'bad_url' });
  });

  it('caps redirects at 3', async () => {
    let n = 0;
    const req: RequestOnce = () => reply(302, { location: `https://example.com/${++n}` });
    await expect(guardedFetch('https://example.com/', {}, req)).rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(n).toBe(4); // initial + 3 followed; the 4th redirect response is refused
  });

  it('rejects wrong content type', async () => {
    const req: RequestOnce = () => reply(200, { 'content-type': 'image/png' }, 'x');
    await expect(guardedFetch('https://example.com/', {}, req)).rejects.toMatchObject({ code: 'bad_content_type' });
  });

  it('rejects non-2xx', async () => {
    await expect(guardedFetch('https://example.com/', {}, () => reply(404, xml))).rejects.toMatchObject({
      code: 'http_status',
      status: 404,
    });
  });

  it('enforces the size cap', async () => {
    const req: RequestOnce = () => reply(200, xml, 'x'.repeat(2000));
    await expect(guardedFetch('https://example.com/', { maxBytes: 1000 }, req)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('enforces the size cap AFTER gunzip (zip bomb)', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(100_000));
    expect(bomb.length).toBeLessThan(1000);
    const req: RequestOnce = () => reply(200, { ...xml, 'content-encoding': 'gzip' }, bomb);
    await expect(guardedFetch('https://example.com/', { maxBytes: 1000 }, req)).rejects.toBeInstanceOf(GuardedFetchError);
  });

  it('times out a hanging body', async () => {
    const req: RequestOnce = () =>
      Promise.resolve({ status: 200, headers: xml, stream: new Readable({ read() {} }), destroy: () => {} });
    await expect(guardedFetch('https://example.com/', { timeoutMs: 50 }, req)).rejects.toMatchObject({ code: 'timeout' });
  });
});
