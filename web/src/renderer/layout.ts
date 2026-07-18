import type { LayoutInfo } from "./types";
import {
  WidthToHeightFactor,
  MaxCircleSize,
  SmallestCircleSize,
  INT_Offset,
  PackingCoefficient,
  LetterGrowFactor,
  MaxLetterSize,
} from "./constants";

/**
 * Turn a chosen letter height into a full LayoutInfo (width, image dims).
 * Used by the calibration-based estimator (calibrate.ts) and by
 * growLetterSize.
 */
export function layoutFromLetterSize(letterSize: number, digitCount: number): LayoutInfo {
  const clamped = Math.max(60, Math.min(MaxLetterSize, Math.round(letterSize)));
  const letterWidth = Math.round(clamped * WidthToHeightFactor);
  return {
    letterSize: clamped,
    letterWidth,
    imageWidth: letterWidth * digitCount,
    imageHeight: clamped,
  };
}

/**
 * Fallback estimator for when calibration data isn't available. Uses avg
 * fill % of the digits, avg circle area, and an empirical
 * PackingCoefficient. DotRenderer's grow-and-retry cleans up any residual
 * shortfall.
 */
export function computeLetterSize(
  number: number,
  fills: number[],
  minCircleSize: number = SmallestCircleSize,
  maxCircleSize: number = MaxCircleSize,
  packingCoefficient: number = PackingCoefficient,
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
      (letterArea * avgCoverage * packingCoefficient) / avgCircleArea;
    if (estimatedCapacity >= numberNeededPerLetter) break;
    testSize = Math.floor(testSize * LetterGrowFactor);
  }

  return layoutFromLetterSize(testSize, digitCount);
}

/**
 * Grow one letter's size (used by DotRenderer's safety-net retry). Capped
 * to MaxLetterSize so we don't produce impossibly large canvases even if
 * the estimator was wildly wrong.
 */
export function growLetterSize(current: LayoutInfo, digitCount: number): LayoutInfo {
  const grown = Math.max(current.letterSize + 1, Math.floor(current.letterSize * LetterGrowFactor));
  return layoutFromLetterSize(grown, digitCount);
}
