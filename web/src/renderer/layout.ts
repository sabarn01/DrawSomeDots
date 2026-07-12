import type { LayoutInfo } from "./types";
import {
  WidthToHeightFactor,
  MaxCircleSize,
  SmallestCircleSize,
  INT_Offset,
  PackingCoefficient,
  LetterGrowFactor,
} from "./constants";

/**
 * Compute the letter size needed so that each digit's allotment of dots can
 * physically fit inside the digit's shape. Uses avg fill % of the digits
 * used, avg circle area, and an empirical PackingCoefficient to account for
 * random-packing inefficiency, INT_Offset padding, and glyph boundary loss.
 *
 * The C# original omitted the packing coefficient, which produced letter
 * sizes far too small for larger N; here we apply it up front, and callers
 * (DotRenderer) still grow-and-retry as a safety net.
 */
export function computeLetterSize(
  number: number,
  fills: number[],
  minCircleSize: number = SmallestCircleSize,
  maxCircleSize: number = MaxCircleSize,
): LayoutInfo {
  const digits = String(number);
  const digitCount = digits.length;
  const numberNeededPerLetter = number / digitCount;

  // Average fill percentage over the digits actually present.
  let avgCoverage = 0;
  for (const ch of digits) avgCoverage += fills[Number(ch)] ?? 0;
  avgCoverage /= digitCount;
  if (avgCoverage <= 0) avgCoverage = 0.1;

  const avgCircleDiameter = (maxCircleSize + INT_Offset + minCircleSize) / 2;
  const avgCircleArea = Math.PI * (avgCircleDiameter / 2) ** 2;

  let testSize = 100;
  // Guard against runaway growth on pathological inputs.
  for (let iter = 0; iter < 60; iter++) {
    const letterArea = testSize * (testSize * WidthToHeightFactor);
    const estimatedCapacity =
      (letterArea * avgCoverage * PackingCoefficient) / avgCircleArea;
    if (estimatedCapacity >= numberNeededPerLetter) break;
    testSize = Math.floor(testSize * LetterGrowFactor);
  }

  const letterSize = testSize;
  const letterWidth = Math.round(letterSize * WidthToHeightFactor);
  const imageWidth = letterWidth * digitCount;
  const imageHeight = letterSize;
  return { letterSize, letterWidth, imageWidth, imageHeight };
}

/**
 * Grow one letter's size (used by DotRenderer's safety-net retry).
 */
export function growLetterSize(current: LayoutInfo, digitCount: number): LayoutInfo {
  const letterSize = Math.max(current.letterSize + 1, Math.floor(current.letterSize * LetterGrowFactor));
  const letterWidth = Math.round(letterSize * WidthToHeightFactor);
  return {
    letterSize,
    letterWidth,
    imageWidth: letterWidth * digitCount,
    imageHeight: letterSize,
  };
}
