import { describe, it, expect } from "vitest";
import { distributeDots } from "../src/renderer/distribute";
import { computeLetterSize, growLetterSize } from "../src/renderer/layout";

describe("distributeDots", () => {
  const fills = [0.5, 0.3, 0.6, 0.55, 0.5, 0.5, 0.6, 0.35, 0.7, 0.6];

  it("always sums to N for a range of N", () => {
    for (const n of [1, 5, 10, 42, 100, 999, 12345]) {
      const out = distributeDots(n, fills);
      expect(out.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it("handles single digit", () => {
    expect(distributeDots(7, fills)).toEqual([7]);
  });

  it("weights higher-fill digits with more dots", () => {
    const contrast = new Array(10).fill(0.1);
    contrast[8] = 0.9;
    // number "180" -> digits [1, 8, 0]; digit '8' has 9x the weight
    const out = distributeDots(180, contrast);
    expect(out[1]).toBeGreaterThan(out[0]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it("sums to N even when all fills are zero", () => {
    const zeros = new Array(10).fill(0);
    const out = distributeDots(42, zeros);
    expect(out.reduce((a, b) => a + b, 0)).toBe(42);
  });
});

describe("computeLetterSize / growLetterSize", () => {
  const fills = new Array(10).fill(0.5);

  it("returns sane sizes for small N", () => {
    const info = computeLetterSize(1, fills);
    expect(info.letterSize).toBeGreaterThan(0);
    expect(info.letterWidth).toBeGreaterThan(0);
    expect(info.imageHeight).toBe(info.letterSize);
  });

  it("scales up for large N", () => {
    const small = computeLetterSize(10, fills);
    const large = computeLetterSize(10000, fills);
    expect(large.letterSize).toBeGreaterThan(small.letterSize);
  });

  it("image width equals letterWidth * digit count", () => {
    const info = computeLetterSize(1234, fills);
    expect(info.imageWidth).toBe(info.letterWidth * 4);
  });

  it("growLetterSize strictly increases letter size", () => {
    const info = computeLetterSize(500, fills);
    const grown = growLetterSize(info, 3);
    expect(grown.letterSize).toBeGreaterThan(info.letterSize);
    expect(grown.imageWidth).toBe(grown.letterWidth * 3);
  });
});
