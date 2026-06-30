import { describe, it, expect } from 'vitest';
import { quoteAppearsIn } from '../../src/engine/evidence';

const source =
  'Should I split this 2000-line file? List the seams first. ' +
  'The test fails one in ten runs and I bet it is a timing race, so verify before fixing.';

describe('quoteAppearsIn', () => {
  it('passes an exact substring (case/whitespace insensitive)', () => {
    expect(quoteAppearsIn('List the seams first.', source)).toBe(true);
    expect(quoteAppearsIn('  LIST   the   SEAMS first  ', source)).toBe(true);
  });

  it('passes an elided "A ... B" quote when both fragments are present', () => {
    expect(quoteAppearsIn('List the seams first ... verify before fixing', source)).toBe(true);
    expect(quoteAppearsIn('List the seams first … verify before fixing', source)).toBe(true);
  });

  it('rejects a fabricated quote that is not in the text and has low overlap', () => {
    expect(quoteAppearsIn('I always deploy straight to production on Fridays.', source)).toBe(false);
  });

  it('rejects a fabrication stitched from the source vocabulary (word order matters)', () => {
    // Every word here exists in the source, but never in this contiguous order.
    expect(quoteAppearsIn('verify the test before fixing the file', source)).toBe(false);
    expect(quoteAppearsIn('the file fails the test before the race fixing it first', source)).toBe(false);
  });

  it('keeps a very short quote (<8 chars) rather than dropping it', () => {
    expect(quoteAppearsIn('split', source)).toBe(true);
    expect(quoteAppearsIn('xyz', source)).toBe(true);
  });

  it('passes a lightly-trimmed quote via a long contiguous word run', () => {
    // Keeps the bulk of the phrasing in order (one trailing word trimmed/typo'd).
    expect(quoteAppearsIn('the test fails one in ten runs and i bet it is a timing rce', source)).toBe(true);
  });

  it('strips surrounding straight quotes before matching', () => {
    expect(quoteAppearsIn('"List the seams first."', source)).toBe(true);
  });
});
