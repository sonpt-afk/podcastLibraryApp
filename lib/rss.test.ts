import { describe, expect, it } from 'vitest';
import { feedIdentity, isEnglish, parseDuration, parseFeed } from './rss';

const feed = (items: string, extra = '') => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title><![CDATA[Show & Tell]]></title>
    <description>About &amp; stuff</description>
    <language>en-US</language>
    <itunes:image href="https://img.example.com/a.jpg"/>
    <itunes:owner><itunes:name>Pat</itunes:name><itunes:email>pat@example.com</itunes:email></itunes:owner>
    ${extra}
    ${items}
  </channel>
</rss>`;

const item = (o: { guid?: string; title?: string; date?: string; dur?: string; enc?: string } = {}) => `
<item>
  <title>${o.title ?? 'Ep'}</title>
  ${o.guid ? `<guid isPermaLink="false">${o.guid}</guid>` : ''}
  ${o.date ? `<pubDate>${o.date}</pubDate>` : ''}
  ${o.dur ? `<itunes:duration>${o.dur}</itunes:duration>` : ''}
  ${o.enc === '' ? '' : `<enclosure url="${o.enc ?? 'https://cdn.example.com/e.mp3'}" type="audio/mpeg" length="1"/>`}
  <description>d</description>
</item>`;

describe('parseFeed', () => {
  it('parses channel metadata (CDATA, entities, namespaces)', () => {
    const f = parseFeed(feed(item()));
    expect(f).toMatchObject({
      title: 'Show & Tell',
      description: 'About & stuff',
      language: 'en-us',
      artUrl: 'https://img.example.com/a.jpg',
      ownerEmail: 'pat@example.com',
      podcastGuid: null,
    });
  });

  it('sorts newest first and normalises dates to ISO', () => {
    const f = parseFeed(
      feed(
        item({ guid: 'a', date: 'Mon, 01 Jan 2024 10:00:00 GMT' }) +
          item({ guid: 'b', date: 'Fri, 01 Mar 2024 10:00:00 GMT' }),
      ),
    );
    expect(f.episodes.map((e) => e.guid)).toEqual(['b', 'a']);
    expect(f.episodes[0].publishedAt).toBe('2024-03-01T10:00:00.000Z');
  });

  it('handles a single <item> (parser returns object, not array)', () => {
    expect(parseFeed(feed(item({ guid: 'only' }))).episodes).toHaveLength(1);
  });

  it('falls back to sha1(enclosure + title) when guid is missing, and it is stable', () => {
    const a = parseFeed(feed(item({ title: 'T' }))).episodes[0].guid;
    const b = parseFeed(feed(item({ title: 'T' }))).episodes[0].guid;
    const c = parseFeed(feed(item({ title: 'Other' }))).episodes[0].guid;
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('skips items without an enclosure', () => {
    expect(parseFeed(feed(item({ guid: 'x', enc: '' }) + item({ guid: 'y' }))).episodes.map((e) => e.guid)).toEqual(['y']);
  });

  it('reads podcast:guid', () => {
    expect(parseFeed(feed(item(), '<podcast:guid>ABC-123</podcast:guid>')).podcastGuid).toBe('ABC-123');
  });

  it('rejects non-RSS input', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow('Not an RSS');
  });
});

describe('parseDuration', () => {
  it.each([
    ['3723', 3723], ['62:03', 3723], ['1:02:03', 3723], ['00:00:30', 30], ['', null], ['abc', null], ['1:2:3:4', null],
  ])('%s -> %s', (raw, out) => expect(parseDuration(raw)).toBe(out));
});

describe('isEnglish', () => {
  it.each([['en', true], ['en-US', true], ['en_gb', true], [null, true], ['es', false], ['fr-CA', false], ['eng', false]])(
    '%s -> %s',
    (l, ok) => expect(isEnglish(l)).toBe(ok),
  );
});

describe('feedIdentity', () => {
  it('ignores scheme, host case, trailing slash, fragment, utm params, param order', () => {
    const base = feedIdentity('https://Feeds.Example.com/show/rss?b=2&a=1');
    expect(feedIdentity('http://feeds.example.com/show/rss/?a=1&b=2&utm_source=x#frag')).toBe(base);
  });
  it('differs for different feeds', () => {
    expect(feedIdentity('https://a.com/x')).not.toBe(feedIdentity('https://a.com/y'));
  });
  it('podcast:guid wins over URL (survives host migration)', () => {
    expect(feedIdentity('https://old.com/f', 'G-1')).toBe(feedIdentity('https://new.com/f', 'g-1'));
  });
});
