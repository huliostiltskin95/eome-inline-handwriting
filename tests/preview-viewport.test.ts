import { expect, it } from 'vitest';
import { previewHeight } from '../src/embeds/preview-viewport';
it('fits width with equal horizontal and vertical zoom on desktop and narrow screens', () => {
  for (const width of [320, 400, 768, 1024, 1440]) {
    const h = previewHeight(width, 1000, 800);
    expect((h - 56) / 800).toBeCloseTo((width - 56) / 1000);
  }
});
it('keeps degenerate and short previews finite and accessible', () => {
  expect(previewHeight(0, 0, 0)).toBe(96);
  expect(previewHeight(400, 2000, 20)).toBe(96);
});
