import { describe, expect, it } from 'vitest';
import { stationFontSize, stationLabel } from '../src/render/labels';

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
