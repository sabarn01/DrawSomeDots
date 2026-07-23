import { renderGlyphMask, maskAt, darkPixelCount } from "./glyphMask";
import { INT_Offset, WidthToHeightFactor, MaxLetterSize, SmallestCircleSize, MaxCircleSize } from "./constants";
import { findBakedCalibration } from "./calibrationData";

/**
 * Per-digit packing calibration for a font. For each digit 0-9 we measure
 * how many dots actually fit inside its glyph at a couple of letter sizes,
 * and derive `dotsPerPixel[d] = dotsPlaced / letterArea`.
 *
 * Different digits pack very differently ("1" is a thin stroke, "8" is
 * chunky), and packing isn't perfectly linear across sizes (thin strokes
 * pack much better once they're wide enough for two dots side-by-side).
 * Measuring per-digit at two sizes captures both effects.
 *
 * Cached in-memory per font plus persisted to localStorage so we only pay
 * the ~200ms measurement cost once per font per browser.
 */

export interface PackingCalibration {
  /**
   * dotsPerPixel[d] = dot count / letter-area for digit d, aggregated
   * across several sample letter sizes so single-size AA/hinting
   * artefacts don't skew the value. Drives BOTH the letter-size math
   * (letterSizeFromCalibration) AND the per-digit dot allocation
   * (distributeDots takes it as the weights array). This is the right
   * quantity for both, because we want each digit sized to hold its
   * share of N dots, and the "share" is proportional to how many dots
   * a digit can actually pack — not to how many ink pixels it has
   * (a "1" has lots of ink for its width but poor packing; an "8"
   * packs efficiently in its bowls).
   */
  dotsPerPixel: number[];
  /**
   * dotsPerPixel measured at each sample size individually, for
   * diagnostics/regression. `perSize[d][i]` is the digit's density at
   * `sampleSizes[i]`. Not consumed at runtime today; kept in the cache
   * so we can tweak the aggregation formula without re-measuring.
   */
  perSize: number[][];
  /** Sample letter sizes used for this measurement, ordered small → large. */
  sampleSizes: number[];
  /** Ms wall-clock spent measuring. Kept for logging/debug. */
  measuredMs: number;
  /** Version tag; bump if the measurement algorithm changes so old cached values get discarded. */
  version: number;
}

const CALIBRATION_VERSION = 4;
const STORAGE_PREFIX = "dsd:calib:v4:";

const memCache = new Map<string, PackingCalibration>();

export function clearCalibrationCache(): void {
  memCache.clear();
  if (typeof localStorage !== "undefined") {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  }
}

/**
 * Get calibration for the given font. Caches per font in memory and in
 * localStorage. First call for a new font is ~150-250ms; subsequent calls
 * (same tab or subsequent page loads) are essentially free.
 */
export async function getCalibration(fontFamily: string): Promise<PackingCalibration> {
  const cached = memCache.get(fontFamily);
  if (cached) return cached;
  // Prefer the Playwright-baked data checked in at `calibrationData.ts`:
  // it was measured against the real drawDigit algorithm at multiple
  // sizes so its dotsPerPixel numbers reflect actual runtime packing.
  // Only falls through to on-the-fly measurement for fonts that
  // weren't baked (e.g., a system font the user typed in themselves).
  const baked = findBakedCalibration(fontFamily);
  if (baked) {
    const sampleSizes = baked.perSize[0]?.map((s) => s.size) ?? [];
    const perSize = baked.perSize.map((arr) => arr.map((s) => s.dotsPerPixel));
    const cal: PackingCalibration = {
      dotsPerPixel: [...baked.dotsPerPixel],
      perSize,
      sampleSizes,
      measuredMs: 0,
      version: CALIBRATION_VERSION,
    };
    memCache.set(fontFamily, cal);
    return cal;
  }
  const stored = loadStored(fontFamily);
  if (stored) {
    memCache.set(fontFamily, stored);
    return stored;
  }
  const measured = await measureFont(fontFamily);
  memCache.set(fontFamily, measured);
  saveStored(fontFamily, measured);
  return measured;
}

function loadStored(fontFamily: string): PackingCalibration | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + fontFamily);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PackingCalibration;
    if (parsed.version !== CALIBRATION_VERSION) return null;
    if (!Array.isArray(parsed.dotsPerPixel) || parsed.dotsPerPixel.length !== 10) return null;
    if (!Array.isArray(parsed.perSize) || parsed.perSize.length !== 10) return null;
    if (!Array.isArray(parsed.sampleSizes) || parsed.sampleSizes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(fontFamily: string, cal: PackingCalibration): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + fontFamily, JSON.stringify(cal));
  } catch {
    // Non-fatal — storage quota or private mode.
  }
}

/**
 * Record an observed runtime packing for a specific digit at a specific
 * letter size. Called by DotRenderer whenever a digit's placement either
 * fully succeeds (informational upper-bound-so-far) or falls short (a
 * true ceiling on that digit's capacity at that size — this is the case
 * that must lower the calibration).
 *
 * Only ratchets `dotsPerPixel[d]` *downward*: seeing more dots fit than
 * expected doesn't tell us the true ceiling, so we leave the conservative
 * estimate alone. Seeing fewer dots fit than expected proves the previous
 * estimate was too optimistic and updates it. Over time the cache
 * converges to a lower bound that no longer triggers grow-and-restart.
 *
 * `dotsAchieved` is the actual number of non-overlapping dots that fit
 * inside the glyph at (letterSize × letterWidth). `success` is true when
 * placement completed with unplaced=0.
 */
export function recordPackingObservation(
  fontFamily: string,
  digit: number,
  letterSize: number,
  letterWidth: number,
  dotsAchieved: number,
  success: boolean,
): void {
  if (digit < 0 || digit > 9) return;
  const cal = memCache.get(fontFamily);
  if (!cal) return;
  const letterArea = letterSize * letterWidth;
  if (letterArea <= 0) return;
  const observedDPP = dotsAchieved / letterArea;
  const prev = cal.dotsPerPixel[digit];
  if (success) {
    // We know only that at least this many fit. Since we don't know the
    // ceiling, do NOT update — treating a success as the ceiling would
    // spuriously shrink future estimates and cause restarts.
    return;
  }
  // Failure: `dotsAchieved` IS the observed ceiling for this digit at
  // this size. Move the cached DPP toward the observation, weighted
  // toward the observation (0.7) so we converge fast. Apply an extra
  // 5% safety pull-down so next run's letterSize has headroom.
  const target = observedDPP * 0.95;
  const next = Math.min(prev, prev * 0.3 + target * 0.7);
  if (next > 0 && next < prev) {
    cal.dotsPerPixel[digit] = next;
    saveStored(fontFamily, cal);
  }
}

/**
 * Compute the letter size needed for the given number using the measured
 * per-digit packing. Returns the tightest S such that sum over digits d
 * in the number of `S² * WHF * dotsPerPixel[d] >= N`. Clamped to
 * MaxLetterSize; DotRenderer's grow-and-retry handles any final shortfall.
 */
/**
 * Compute the letter size needed for the given number using the measured
 * per-digit packing. The constraint is per-digit — every digit d in the
 * number must satisfy `S² * WHF * dotsPerPixel[d] >= perDigit[d]`, so we
 * take the max requirement across the digits actually used rather than
 * the weighted average. This is important because once any single digit
 * runs out of room and triggers the grow-and-retry, all previously-placed
 * digits get their tile bitmaps upscaled (blurry) and the final
 * composite mixes fresh + rescaled letters. Sizing to the toughest digit
 * up front means we render every digit exactly once at the correct
 * resolution.
 *
 * `perDigit` is the dot allocation from `distributeDots(number, fills)`;
 * `digits` is `String(number)`.
 */
export function letterSizeFromCalibration(
  number: number,
  perDigit: number[],
  digits: string,
  cal: PackingCalibration,
): number {
  let maxS2 = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    const dpp = cal.dotsPerPixel[d];
    if (!dpp || dpp <= 0) continue;
    // S² such that S² * WHF * dpp >= perDigit[i]
    const s2 = perDigit[i] / (WidthToHeightFactor * dpp);
    if (s2 > maxS2) maxS2 = s2;
  }
  if (maxS2 <= 0) {
    // No calibrated digits (e.g., all-zeros font or fresh cache miss);
    // fall back to a whole-number estimate so we return something sane.
    let sumDPP = 0;
    for (const ch of digits) sumDPP += cal.dotsPerPixel[Number(ch)] ?? 0;
    if (sumDPP <= 0) return 200;
    maxS2 = number / (WidthToHeightFactor * sumDPP);
  }
  // Apply a safety margin so runtime placement (random probes + aggressive
  // infill) still fits without triggering the very-expensive
  // grow-and-retry-from-scratch. 8% linear inflation ≈ 17% extra area.
  const SafetyMargin = 1.08;
  const s = Math.ceil(Math.sqrt(maxS2) * SafetyMargin);
  return Math.max(120, Math.min(MaxLetterSize, s));
}

/**
 * Letter sizes at which each digit's packing density is sampled. Sampling
 * at multiple sizes captures the fact that packing isn't linear in area:
 * a thin-stroke digit like "1" packs poorly at small sizes (stroke isn't
 * wide enough for two dots side-by-side) but well once it's large. We
 * aggregate the samples with a bias toward the larger sizes because the
 * runtime letter size for large N is typically several hundred pixels,
 * so those samples are the most representative. Ordered small → large.
 * Configurable per font in `FontPackingSampleSizes` below; 4–6 sizes is
 * a good balance of accuracy vs first-run measurement time.
 */
export const DefaultPackingSampleSizes = [180, 300, 460, 640] as const;

/**
 * Per-font overrides for the packing sample sizes. Use this when a
 * particular font has unusual metrics (heavy hinting, condensed glyphs)
 * that call for a different sampling range. Keys are matched
 * case-insensitively against `fontFamily`. Fonts not listed here fall
 * back to `DefaultPackingSampleSizes`.
 */
export const FontPackingSampleSizes: Record<string, readonly number[]> = {
  // "Impact":        [160, 280, 440, 620, 820],
  // "Comic Sans MS": [180, 320, 500, 700],
};

function packingSamplesFor(fontFamily: string): readonly number[] {
  for (const key of Object.keys(FontPackingSampleSizes)) {
    if (key.toLowerCase() === fontFamily.toLowerCase()) return FontPackingSampleSizes[key];
  }
  return DefaultPackingSampleSizes;
}

async function measureFont(
  fontFamily: string,
  sampleSizes: readonly number[] = packingSamplesFor(fontFamily),
): Promise<PackingCalibration> {
  const t0 = performance.now();
  const sizes = [...sampleSizes].sort((a, b) => a - b);

  // perSize[d][i] = dotsPerPixel for digit d at sizes[i]
  const perSize: number[][] = Array.from({ length: 10 }, () => new Array(sizes.length).fill(0));

  for (let d = 0; d <= 9; d++) {
    for (let i = 0; i < sizes.length; i++) {
      perSize[d][i] = measureDigit(String(d), fontFamily, sizes[i]);
    }
    if (d % 2 === 1) await yieldOnce();
  }

  // Aggregate each digit's samples into a single dotsPerPixel. We weight
  // toward the larger sizes because packing density asymptotes as the
  // stroke gets wide enough to hold multiple dots across, and runtime
  // letter sizes for realistic N are hundreds of pixels — much closer
  // to our large samples than our small ones. Linear weights over the
  // sorted samples (small → large) give the largest sample the highest
  // weight without discarding the smaller samples entirely (they still
  // help stabilize noisy jitter placements).
  const dotsPerPixel: number[] = new Array(10).fill(0);
  let weightSum = 0;
  for (let i = 0; i < sizes.length; i++) weightSum += i + 1;
  for (let d = 0; d <= 9; d++) {
    let acc = 0;
    for (let i = 0; i < sizes.length; i++) acc += perSize[d][i] * (i + 1);
    dotsPerPixel[d] = Math.max(acc / weightSum, 1e-6);
  }

  return {
    dotsPerPixel,
    perSize,
    sampleSizes: [...sizes],
    measuredMs: performance.now() - t0,
    version: CALIBRATION_VERSION,
  };
}

function yieldOnce(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * Fast packing measurement for a single digit at a single letter size.
 * Uses a bucketed grid for O(1) neighbor lookup so we don't pay the
 * production quadtree overhead — we only need a count, not visuals.
 *
 * Uses the default min/max circle sizes from constants.ts because that's
 * what the runtime uses (the sliders were removed).
 */
function measureDigit(
  digit: string,
  fontFamily: string,
  letterSize: number,
): number {
  const letterWidth = Math.round(letterSize * WidthToHeightFactor);
  const mask = renderGlyphMask(digit, fontFamily, letterSize, letterWidth);
  if (darkPixelCount(mask) === 0) return 0;
  const { bounds } = mask;
  if (bounds.width === 0 || bounds.height === 0) return 0;

  const letterArea = letterSize * letterWidth;
  const avgDiameter = (SmallestCircleSize + MaxCircleSize) / 2;
  // Smaller step + more jitter attempts than the C# heuristic. Diagonals
  // and thin strokes (7, 1, 4) have narrow valid bands that a coarse
  // grid overshoots — a finer grid with more attempts per cell brings
  // measured capacity in line with what the runtime random-probe
  // placement actually achieves.
  const step = Math.max(2, Math.floor(avgDiameter * 0.7));
  const jitterAttempts = 8;
  const r = avgDiameter / 2 + 0.5;

  // Neighbor grid keyed by cell of size `cellSize`.
  const cellSize = Math.max(step, 4);
  const gridCols = Math.max(1, Math.ceil(bounds.width / cellSize));
  const gridRows = Math.max(1, Math.ceil(bounds.height / cellSize));
  const grid: number[][] = new Array(gridCols * gridRows);
  for (let i = 0; i < grid.length; i++) grid[i] = [];

  interface P { cx: number; cy: number; }
  const placed: P[] = [];

  const cellOf = (x: number, y: number): number => {
    const gx = Math.max(0, Math.min(gridCols - 1, Math.floor((x - bounds.x) / cellSize)));
    const gy = Math.max(0, Math.min(gridRows - 1, Math.floor((y - bounds.y) / cellSize)));
    return gy * gridCols + gx;
  };

  const insideGlyph = (cx: number, cy: number): boolean => {
    if (!maskAt(mask, cx, cy)) return false;
    if (!maskAt(mask, cx + r, cy)) return false;
    if (!maskAt(mask, cx - r, cy)) return false;
    if (!maskAt(mask, cx, cy + r)) return false;
    if (!maskAt(mask, cx, cy - r)) return false;
    return true;
  };

  const minDist = 2 * r + INT_Offset / 2;
  const minDist2 = minDist * minDist;
  const overlaps = (cx: number, cy: number): boolean => {
    const gx = Math.max(0, Math.min(gridCols - 1, Math.floor((cx - bounds.x) / cellSize)));
    const gy = Math.max(0, Math.min(gridRows - 1, Math.floor((cy - bounds.y) / cellSize)));
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= gridRows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= gridCols) continue;
        const bucket = grid[ny * gridCols + nx];
        for (const idx of bucket) {
          const p = placed[idx];
          const ddx = p.cx - cx;
          const ddy = p.cy - cy;
          if (ddx * ddx + ddy * ddy < minDist2) return true;
        }
      }
    }
    return false;
  };

  // Grid-with-jitter sweep. Not the production algorithm (which is random
  // + fallback), but it produces a stable per-digit density estimate that
  // correlates well with what drawDigit ends up placing.
  for (let gy = bounds.y; gy < bounds.y + bounds.height; gy += step) {
    for (let gx = bounds.x; gx < bounds.x + bounds.width; gx += step) {
      for (let jitter = 0; jitter < jitterAttempts; jitter++) {
        const cx = gx + Math.floor(Math.random() * step);
        const cy = gy + Math.floor(Math.random() * step);
        if (!insideGlyph(cx, cy)) continue;
        if (overlaps(cx, cy)) continue;
        const idx = placed.length;
        placed.push({ cx, cy });
        grid[cellOf(cx, cy)].push(idx);
        break;
      }
    }
  }

  return placed.length / letterArea;
}
