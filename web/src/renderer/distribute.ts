import { renderGlyphMask, darkPixelCount } from "./glyphMask";
import { WidthToHeightFactor } from "./constants";

const CACHE_SIZE = 50;

const fillCache = new Map<string, number[]>();

/**
 * For a given font family, return an array of length 10 whose i-th entry is
 * the fraction of pixels covered when digit i is rendered. Cached per font.
 * Caller should await document.fonts.ready before first invocation.
 */
export function getFillPercentages(fontFamily: string): number[] {
  const cached = fillCache.get(fontFamily);
  if (cached) return cached;

  const result: number[] = [];
  const letterWidth = Math.round(CACHE_SIZE * WidthToHeightFactor);
  for (let d = 0; d <= 9; d++) {
    const m = renderGlyphMask(String(d), fontFamily, CACHE_SIZE, letterWidth);
    const dark = darkPixelCount(m);
    const total = m.width * m.height;
    result.push(total > 0 ? dark / total : 0);
  }
  fillCache.set(fontFamily, result);
  return result;
}

export function clearFillCache(): void {
  fillCache.clear();
}

/**
 * Distribute N dots across the digits of `number` weighted by each digit's
 * fill percentage. Uses the same +/-1 rounding-fixup loop as the C# original
 * so the returned array always sums to exactly N.
 */
export function distributeDots(number: number, fills: number[]): number[] {
  const digits = String(number);
  const n = digits.length;

  let totalWeight = 0;
  for (const ch of digits) totalWeight += fills[Number(ch)] ?? 0;
  if (totalWeight === 0) totalWeight = 1;

  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const dv = Number(digits[i]);
    out[i] = Math.floor(number * ((fills[dv] ?? 0) / totalWeight));
  }

  let insertPos = 0;
  let sum = out.reduce((a, b) => a + b, 0);
  // Safety cap so a bad input can't hang the loop
  let guard = number * 4 + 100;
  while (sum !== number && guard-- > 0) {
    insertPos++;
    if (insertPos >= n) insertPos = 0;
    out[insertPos] += sum > number ? -1 : 1;
    sum = out.reduce((a, b) => a + b, 0);
  }
  return out;
}
