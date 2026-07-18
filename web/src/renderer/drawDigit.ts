import type { Dot, GlyphMask, LetterProgress, PlacementAttempt } from "./types";
import { Quadtree } from "./quadtree";
import { maskAt, drawFittedGlyph } from "./glyphMask";
import { INT_Offset, TryMultiplyer } from "./constants";

export interface DrawDigitResult {
  canvas: HTMLCanvasElement;
  placed: number;
  unplaced: number;
}

export interface DrawDigitParams {
  digit: string;
  fontFamily: string;
  letterSize: number;
  letterWidth: number;
  numDots: number;
  digitIndex: number;
  minCircleSize: number;
  maxCircleSize: number;
  onProgress?: (p: LetterProgress) => void;
  yieldFn?: () => Promise<void>;
  mask: GlyphMask;
}

function randomColor(): string {
  const r = (Math.random() * 256) | 0;
  const g = (Math.random() * 256) | 0;
  const b = (Math.random() * 256) | 0;
  return `rgb(${r},${g},${b})`;
}

function randInt(min: number, maxExclusive: number): number {
  return min + Math.floor(Math.random() * (maxExclusive - min));
}

/**
 * Try to place `numDots` non-overlapping colored circles inside the digit's
 * inked region (per `mask`). Uses a quadtree for O(log n) overlap queries.
 *
 * Returns the resulting canvas plus counts of placed/unplaced dots. Callers
 * (DotRenderer) can grow the letter size and retry if unplaced > 0.
 */
export async function drawDigit(
  params: DrawDigitParams,
): Promise<DrawDigitResult> {
  const {
    digit,
    fontFamily,
    letterSize,
    letterWidth,
    numDots,
    digitIndex,
    minCircleSize,
    maxCircleSize,
    onProgress,
    yieldFn,
    mask,
  } = params;

  const canvas = document.createElement("canvas");
  canvas.width = letterWidth;
  canvas.height = letterSize;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, letterWidth, letterSize);

  // Faint background outline of the digit so viewers can see the shape while
  // it fills in. Uses the same fitted-glyph logic as the mask so the outline
  // aligns exactly with where dots will land.
  ctx.save();
  drawFittedGlyph(ctx, digit, fontFamily, letterWidth, letterSize, "white");
  ctx.restore();

  const { bounds } = mask;
  if (bounds.width === 0 || bounds.height === 0) {
    return { canvas, placed: 0, unplaced: numDots };
  }

  const qt = new Quadtree({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });

  const target = numDots;
  let placed = 0;
  let tryCount = 0;
  const maxTries = target * TryMultiplyer;
  // Time-based yielding: repaint at ~60fps so individual dots are visible as
  // they land, without paying a full event-loop yield per dot for large N.
  const FrameBudgetMs = 16;
  let lastYield = performance.now();

  // Aggressive-infill state: once random placement fails, we scan the mask
  // linearly for a free spot. Keeping the scan cursor persistent across
  // aggressive placements is critical for large N: without it,
  // findAnyFreeSpot restarts from a fixed origin on every call and does
  // O(bounds_area) work per placement → O(N²) total, which is minutes
  // per digit at N=176k. With a persistent monotonic cursor the total
  // aggressive-infill work amortises to O(bounds_area + placements).
  //
  // Cursor state is stored on the mask's local grid (row-major cells of
  // size `aggressiveStep`); we advance one cell per placement and wrap
  // exactly once through the whole bounds.
  const aggressiveStep = Math.max(1, Math.floor(minCircleSize / 2 + 0.5));
  const aggressiveCols = Math.max(1, Math.floor(bounds.width / aggressiveStep));
  const aggressiveRows = Math.max(1, Math.floor(bounds.height / aggressiveStep));
  const aggressiveTotal = aggressiveRows * aggressiveCols;
  // Start the cursor at a random cell so the first aggressive dots don't
  // all land in the top-left corner. Once random probes stop working we
  // just march sequentially from there.
  let aggressiveCursor = Math.floor(Math.random() * aggressiveTotal);
  let aggressiveExhausted = false;

  const isInsideGlyph = (cx: number, cy: number, r: number): boolean => {
    if (!maskAt(mask, cx, cy)) return false;
    // Sample 4 points on the circle edge (N/E/S/W). This is much cheaper than
    // a full mask fill scan and catches dots that spill outside the glyph.
    if (!maskAt(mask, cx + r, cy)) return false;
    if (!maskAt(mask, cx - r, cy)) return false;
    if (!maskAt(mask, cx, cy + r)) return false;
    if (!maskAt(mask, cx, cy - r)) return false;
    return true;
  };

  const overlaps = (cx: number, cy: number, r: number): boolean => {
    const searchR = r + maxCircleSize / 2 + INT_Offset;
    const nearby = qt.queryCircle(cx, cy, searchR);
    for (const d of nearby) {
      const dx = d.cx - cx;
      const dy = d.cy - cy;
      const minDist = d.r + r + INT_Offset / 2;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  };

  // Rolling buffer of recent placement attempts (both successful and failed)
  // for UI visualization. Kept small so the UI paint cost stays trivial.
  const AttemptWindow = 40;
  const attempts: PlacementAttempt[] = [];
  const recordAttempt = (x: number, y: number, ok: boolean): void => {
    if (attempts.length >= AttemptWindow) attempts.shift();
    attempts.push({ x, y, ok });
  };

  // Rolling throughput measurement: we adapt random-probe budget based on
  // the actual placement rate observed over the last WindowSize placements.
  // When placements are cheap (dots landing quickly), random gives us
  // nice visual variety, so we spend more probes on it. When placements
  // are expensive (crowded digit, most probes rejected), we cut random
  // to a bare minimum and defer to aggressive infill.
  const WindowSize = 64;
  const recentTimes: number[] = [];
  const LowRate = 200; // dots/sec below which we consider "struggling"
  const HighRate = 800; // dots/sec above which random is clearly working
  const recordPlacement = (): void => {
    const now = performance.now();
    recentTimes.push(now);
    if (recentTimes.length > WindowSize) recentTimes.shift();
  };
  const currentRate = (): number => {
    if (recentTimes.length < 8) return Infinity;
    const dur = recentTimes[recentTimes.length - 1] - recentTimes[0];
    return ((recentTimes.length - 1) * 1000) / Math.max(1, dur);
  };
  const probeBudget = (): number => {
    const rate = currentRate();
    if (rate <= LowRate) return 2;
    if (rate >= HighRate) return 20;
    // Linear interpolate between the two rate bands.
    const t = (rate - LowRate) / (HighRate - LowRate);
    return Math.max(2, Math.round(2 + t * 18));
  };

  while (placed < target) {
    // Choose radius: full range while we have budget, shrink to smallest when
    // we've used more than TryMultiplyer * target attempts.
    const rMax =
      tryCount < maxTries ? maxCircleSize : minCircleSize;
    const rMin = minCircleSize;
    let r = randInt(rMin, rMax + 1) / 2 + 0.5; // radius in pixels

    let attemptedThisDot = 0;
    let accepted = false;
    let cx = 0;
    let cy = 0;
    // Random-probe budget adapts to observed placement throughput — when
    // the digit is crowded and placements slow down, we drop straight
    // through to aggressive infill; when it's still filling fast, we
    // give random a full 20 probes for variety.
    const MaxRandomProbes = probeBudget();
    while (attemptedThisDot < MaxRandomProbes) {
      attemptedThisDot++;
      tryCount++;
      cx = randInt(bounds.x, bounds.x + bounds.width);
      cy = randInt(bounds.y, bounds.y + bounds.height);
      if (!isInsideGlyph(cx, cy, r)) {
        recordAttempt(cx, cy, false);
        continue;
      }
      if (overlaps(cx, cy, r)) {
        recordAttempt(cx, cy, false);
        continue;
      }
      accepted = true;
      break;
    }

    if (!accepted) {
      // Fallback: sequential scan from the persistent cursor. Amortised
      // O(1) per placement across the whole aggressive-infill phase.
      if (aggressiveExhausted) {
        break; // whole glyph scanned; caller grows letter size + retries
      }
      const found = findAnyFreeSpot(
        mask,
        qt,
        minCircleSize / 2 + 0.5,
        maxCircleSize,
        aggressiveCursor,
        aggressiveStep,
        aggressiveCols,
        aggressiveRows,
      );
      if (!found) {
        aggressiveExhausted = true;
        break;
      }
      cx = found.cx;
      cy = found.cy;
      // findAnyFreeSpot checked "inside glyph" only at the cell center and
      // computed overlap with the smallest radius, so we MUST place at
      // that same radius — otherwise we'd overlap neighbours (up to
      // 1.5px) and spill outside the glyph edge. This costs some visual
      // variety in the crowded tail of a digit, which is a fine trade.
      r = minCircleSize / 2 + 0.5;
      // Advance the cursor just past the found cell so the next call
      // resumes right after it rather than re-scanning.
      aggressiveCursor = (found.nextCursor + 1) % aggressiveTotal;
    }

    const color = randomColor();
    const dot: Dot = { cx, cy, r, color };
    qt.insert(dot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    ctx.stroke();

    placed++;
    recordAttempt(cx, cy, true);
    recordPlacement();

    // Time-based progress + yield: fire an update and hand the event loop
    // back to the browser whenever a frame's worth of time has elapsed.
    // This makes the digit visibly build up dot-by-dot for small N and
    // still runs smoothly for large N.
    const now = performance.now();
    if (now - lastYield >= FrameBudgetMs) {
      onProgress?.({ digitIndex, drawn: placed, total: target, canvas, attempts });
      if (yieldFn) await yieldFn();
      lastYield = performance.now();
    }
  }

  if (onProgress) {
    onProgress({ digitIndex, drawn: placed, total: target, canvas, attempts });
  }

  return { canvas, placed, unplaced: target - placed };
}

/**
 * Scan the glyph mask starting from `startCursor` (linear index into a
 * `rows × cols` grid of cells of size `step`) for the next cell that is
 * both inside the glyph and clear of any placed dot. Wraps through the
 * full grid exactly once, so the total scan work across all aggressive
 * placements for one digit is O(rows*cols) rather than O(N*rows*cols).
 *
 * Returns the found (cx, cy) plus the cursor position where it was
 * found so the caller can resume just past it.
 */
function findAnyFreeSpot(
  mask: GlyphMask,
  qt: Quadtree,
  r: number,
  maxCircleSize: number,
  startCursor: number,
  step: number,
  cols: number,
  rows: number,
): { cx: number; cy: number; nextCursor: number } | null {
  const { bounds } = mask;
  const total = rows * cols;
  for (let i = 0; i < total; i++) {
    const c = (startCursor + i) % total;
    const gy = (c / cols) | 0;
    const gx = c - gy * cols;
    const x = bounds.x + gx * step;
    const y = bounds.y + gy * step;
    if (!maskAt(mask, x, y)) continue;
    const nearby = qt.queryCircle(x, y, r + maxCircleSize / 2 + INT_Offset);
    let clear = true;
    for (const d of nearby) {
      const ddx = d.cx - x;
      const ddy = d.cy - y;
      const minDist = d.r + r + INT_Offset / 2;
      if (ddx * ddx + ddy * ddy < minDist * minDist) {
        clear = false;
        break;
      }
    }
    if (clear) return { cx: x, cy: y, nextCursor: c };
  }
  return null;
}
