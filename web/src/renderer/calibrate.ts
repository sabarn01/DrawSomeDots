import { renderGlyphMask, maskAt, darkPixelCount } from "./glyphMask";
import { INT_Offset, WidthToHeightFactor, MaxLetterSize, SmallestCircleSize, MaxCircleSize } from "./constants";

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
  /** dotsPerPixel[d] = dot count / letter-area for digit d. */
  dotsPerPixel: number[];
  /** Ms wall-clock spent measuring. Kept for logging/debug. */
  measuredMs: number;
  /** Version tag; bump if the measurement algorithm changes so old cached values get discarded. */
  version: number;
}

const CALIBRATION_VERSION = 2;
const STORAGE_PREFIX = "dsd:calib:v2:";

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

async function measureFont(fontFamily: string): Promise<PackingCalibration> {
  const t0 = performance.now();
  // Measure at two sizes: small (fast, captures worst-case boundary effects)
  // and medium (more accurate for large glyphs). If they disagree
  // significantly, prefer the medium reading — thin-stroke digits like "1"
  // often pack much better once the stroke is wide enough to fit two dots.
  const sizeSmall = 220;
  const sizeLarge = 500;

  const dotsPerPixel: number[] = new Array(10).fill(0);
  for (let d = 0; d <= 9; d++) {
    const small = measureDigit(String(d), fontFamily, sizeSmall);
    const large = measureDigit(String(d), fontFamily, sizeLarge);
    // Weighted average leaning toward the large reading, but never below
    // the small one (worst-case for a smallish letter is still small).
    const dpp =
      large > small * 1.15 ? large * 0.85 + small * 0.15 : (small + large) / 2;
    dotsPerPixel[d] = Math.max(dpp, 1e-6);
    // Yield periodically so calibration doesn't block the UI thread.
    if (d % 3 === 2) await yieldOnce();
  }

  return {
    dotsPerPixel,
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
  const step = Math.max(2, Math.floor(avgDiameter * 0.9));
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
      for (let jitter = 0; jitter < 3; jitter++) {
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
