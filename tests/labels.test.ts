import { describe, expect, it } from 'vitest';
import { overlapsAny, stationFontSize, stationLabel } from '../src/render/labels';

describe('overlapsAny', () => {
  const boxes = new Float64Array([0, 0, 50, 12, 100, 0, 50, 12]);
  it('detects intersection with any of the first count boxes', () => {
    expect(overlapsAny(boxes, 2, 40, 6, 20, 12)).toBe(true);
    expect(overlapsAny(boxes, 2, 120, 5, 10, 10)).toBe(true);
    expect(overlapsAny(boxes, 1, 120, 5, 10, 10)).toBe(false);
    expect(overlapsAny(boxes, 0, 0, 0, 50, 12)).toBe(false);
  });
  it('treats touching edges as no overlap', () => {
    expect(overlapsAny(boxes, 2, 50, 0, 50, 12)).toBe(false);
    expect(overlapsAny(boxes, 2, 0, 12, 50, 12)).toBe(false);
  });
});

// Two mono glyphs at 0.6 em each.
const twoGlyphs = (px: number) => px * 1.2;

describe('stationLabel', () => {
  it('is index + 1, zero-padded to two digits', () => {
    expect(stationLabel(0)).toBe('01');
    expect(stationLabel(5)).toBe('06');
    expect(stationLabel(9)).toBe('10');
    expect(stationLabel(99)).toBe('100');
  });
});

describe('stationFontSize', () => {
  it('uses about 0.55 cell when the text fits', () => {
    expect(stationFontSize(20, twoGlyphs)).toBeCloseTo(11);
    expect(twoGlyphs(stationFontSize(20, twoGlyphs))).toBeLessThanOrEqual(0.8 * 20);
  });

  it('never goes below 7px when the text fits', () => {
    expect(stationFontSize(12, twoGlyphs)).toBe(7); // 8.4px wide <= 9.6px
  });

  it('scales down to fit 0.8 cell when two digits are too wide', () => {
    const size = stationFontSize(8, twoGlyphs); // 7px would be 8.4px wide > 6.4px
    expect(size).toBeLessThan(7);
    expect(twoGlyphs(size)).toBeCloseTo(0.8 * 8);
  });

  it('keeps fitting for a wide font across cell sizes', () => {
    const wide = (px: number) => px * 2;
    for (const cell of [4, 8, 12, 16, 24, 40]) {
      expect(wide(stationFontSize(cell, wide))).toBeLessThanOrEqual(0.8 * cell + 1e-9);
    }
  });
});
