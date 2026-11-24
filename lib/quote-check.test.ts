import { describe, expect, it } from 'vitest';
import { demoteQuotes, extractQuotes, flagUnverified, normalize, ungroundedQuotes } from './quote-check';
import type { Segment } from './providers/types';

const seg = (id: number, text: string): Segment => ({ id, speaker: 'A', start_ms: id * 1000, text });
const segs = [
  seg(0, "We started in 2019 with twelve customers, and honestly it wasn't easy."),
  seg(1, 'Jane Doe told us that the best marketing is a product people can’t stop talking about.'),
  seg(2, 'Then we scaled to 4,500 users.'),
];

describe('normalize', () => {
  it('ignores case, punctuation and smart quotes', () => {
    expect(normalize('Can’t  STOP, talking!')).toBe(normalize("can't stop talking"));
  });
});

describe('extractQuotes', () => {
  it('finds straight and curly quotes with positions', () => {
    const md = 'He said "one two three four" and “five six seven eight”.';
    const q = extractQuotes(md);
    expect(q.map((x) => x.text)).toEqual(['one two three four', 'five six seven eight']);
    expect(md.slice(q[0].start, q[0].end)).toBe('"one two three four"');
  });
});

describe('ungroundedQuotes', () => {
  it('accepts a verbatim quote even with different case/punctuation/quote style', () => {
    const md = 'Jane said “The best marketing is a product people can’t stop talking about”.';
    expect(ungroundedQuotes(md, segs)).toEqual([]);
  });

  it('flags an invented quote', () => {
    const md = 'Jane said "we will dominate the whole market by next year".';
    expect(ungroundedQuotes(md, segs)).toHaveLength(1);
  });

  it('flags a doctored quote (one word changed)', () => {
    const md = 'Jane said "the worst marketing is a product people can\'t stop talking about".';
    expect(ungroundedQuotes(md, segs)).toHaveLength(1);
  });

  it('accepts an ellipsis quote when every fragment is real', () => {
    expect(ungroundedQuotes('"We started in 2019 … it wasn\'t easy"', segs)).toEqual([]);
    expect(ungroundedQuotes('"We started in 2019 ... it was trivial"', segs)).toHaveLength(1);
  });

  it('ignores short scare-quotes', () => {
    expect(ungroundedQuotes('The so-called "growth hack" is overrated.', segs)).toEqual([]);
  });

  it('does not match across a word boundary', () => {
    // "stop talk" is a prefix of a real word sequence but not whole words
    expect(ungroundedQuotes('"can\'t stop talk about it now"', segs)).toHaveLength(1);
  });
});

describe('demoteQuotes', () => {
  it('strips marks only around the given quotes', () => {
    const md = 'A "real quote that is here" and "invented quote that is fake" end.';
    const bad = [extractQuotes(md)[1]];
    expect(demoteQuotes(md, bad)).toBe('A "real quote that is here" and invented quote that is fake end.');
  });
});

describe('flagUnverified', () => {
  it('flags numbers and names absent from the segments, not present ones', () => {
    const md = '# Growth Story\n\nIn 2019 they had 99 customers. Jane Doe and Bob Smith agreed. 4,500 users.';
    const f = flagUnverified(md, segs);
    expect(f.unverifiedNumbers).toEqual(['99']);
    expect(f.unverifiedNames).toEqual(['Bob Smith']);
  });
});
