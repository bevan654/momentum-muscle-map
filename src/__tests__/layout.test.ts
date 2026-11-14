import { describe, expect, it } from 'vitest';
import { fitBody } from '../core';
import maleFront from '../data/male-front';

describe('fitBody', () => {
  const [x0, y0, x1, y1] = maleFront.bounds;

  it('fits the silhouette inside the box, centred, touching the tighter side', () => {
    for (const [w, h] of [[400, 800], [800, 300], [56, 120]] as const) {
      const { scale, tx, ty } = fitBody(maleFront, w, h);
      const left = x0 * scale + tx;
      const right = x1 * scale + tx;
      const top = y0 * scale + ty;
      const bottom = y1 * scale + ty;
      expect(left).toBeGreaterThanOrEqual(-1e-6);
      expect(top).toBeGreaterThanOrEqual(-1e-6);
      expect(right).toBeLessThanOrEqual(w + 1e-6);
      expect(bottom).toBeLessThanOrEqual(h + 1e-6);
      expect(left).toBeCloseTo(w - right, 6);
      expect(top).toBeCloseTo(h - bottom, 6);
      expect(Math.min(left, top)).toBeCloseTo(0, 6);
    }
  });

  it('keeps padding clear on every side', () => {
    const { scale, tx, ty } = fitBody(maleFront, 400, 800, 20);
    expect(x0 * scale + tx).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(y0 * scale + ty).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(y1 * scale + ty).toBeLessThanOrEqual(780 + 1e-6);
  });

  it('gives a zero scale when there is no room', () => {
    expect(fitBody(maleFront, 0, 0).scale).toBe(0);
    expect(fitBody(maleFront, 10, 100, 20).scale).toBe(0);
  });
});
