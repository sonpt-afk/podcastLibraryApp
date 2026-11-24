import { describe, expect, it } from 'vitest';
import { renderEbookPdf } from './pdf';

describe('renderEbookPdf', () => {
  it('renders a valid PDF with cover, contents and chapters', async () => {
    const buf = await renderEbookPdf({
      title: 'Book',
      subtitle: 'Sub',
      author: 'A',
      accentColor: '#1f4e79',
      chapters: [
        { title: 'One', markdown: '# One\n\nPara with **bold** and *em*.\n\n> "a quote from the show"\n\n- a\n- b\n\n1. x\n2. y' },
        { title: 'Two', markdown: '## Sub\n\nText' },
      ],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  });
});
