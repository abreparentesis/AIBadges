import { describe, it, expect } from 'vitest';
import { mapLimit } from '../../src/engine/parallel';

describe('mapLimit', () => {
  it('maps all items, preserving order', async () => {
    expect(await mapLimit([1, 2, 3, 4], 2, async (n) => n * 2)).toEqual([2, 4, 6, 8]);
  });
  it('never exceeds the concurrency limit', async () => {
    let active = 0, peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
