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

  // Aggressive-infill state: once random placement fails, we walk a
  // short "run" of cells in a random direction (H / V / diag) from a
  // random start, then pick a fresh random start + direction. This
  // scatters the fallback dots organically instead of the horizontal-
  // stripe pattern a single row-major sweep produces.
  //
  // Exhaustion detection: we count total *distinct cells visited* across
  // all runs; once that exceeds the total cell count (with slack for
  // re-visits during random walks), the digit is treated as full and the
  // caller can grow letter size and restart.
  const aggressiveStep = Math.max(1, Math.floor(minCircleSize / 2 + 0.5));
  const aggressiveCols = Math.max(1, Math.floor(bounds.width / aggressiveStep));
  const aggressiveRows = Math.max(1, Math.floor(bounds.height / aggressiveStep));
  const aggressiveTotal = aggressiveRows * aggressiveCols;
  // Short runs (4-12 dots) so any visible chunk stays small and hard to
  // read as a line. After each run we repick a fresh random start and
  // direction; between placements within a run we also leave a random
  // 0-3 cell gap so consecutive dots aren't cheek-by-jowl.
  const AggressiveRunMin = 4;
  const AggressiveRunMax = 12;
  const AggressiveMaxGapCells = 3;
  const aggressiveVisitBudget = aggressiveTotal * 3;
  let aggressiveCellsVisited = 0;
  let aggressiveExhausted = false;
  // Cursor + run state.
  let ag_gx = Math.floor(Math.random() * aggressiveCols);
  let ag_gy = Math.floor(Math.random() * aggressiveRows);
  let ag_dx = 1;
  let ag_dy = 0;
  let ag_runLeft = 0;
  const pickNewRun = (): void => {
    ag_gx = Math.floor(Math.random() * aggressiveCols);
    ag_gy = Math.floor(Math.random() * aggressiveRows);
    // 8 directions: H, V, and 4 diagonals. All unit-magnitude in the grid.
    const dirs: Array<[number, number]> = [
      [1, 0], [-1, 0],
      [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
    ag_dx = dx;
    ag_dy = dy;
    ag_runLeft =
      AggressiveRunMin + Math.floor(Math.random() * (AggressiveRunMax - AggressiveRunMin + 1));
  };
  pickNewRun();

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
      // Fallback: directional random-walk in cells. Try up to a few
      // consecutive runs to find a spot; each run gives up after
      // walking off-grid or exhausting its step budget. Once we've
      // burned through the visit budget for the whole digit, treat it
      // as full and let the caller grow.
      if (aggressiveExhausted) {
        break;
      }
      let found: { cx: number; cy: number; steps: number } | null = null;
      // Give ourselves a bounded number of run-restarts per placement so
      // a nearly-full digit terminates instead of spinning forever.
      const maxRunsPerPlacement = 6;
      for (let runAttempt = 0; runAttempt < maxRunsPerPlacement; runAttempt++) {
        if (ag_runLeft <= 0) pickNewRun();
        const walkResult = walkForFreeSpot(
          mask,
          qt,
          minCircleSize / 2 + 0.5,
          maxCircleSize,
          ag_gx,
          ag_gy,
          ag_dx,
          ag_dy,
          ag_runLeft,
          aggressiveStep,
          aggressiveCols,
          aggressiveRows,
        );
        aggressiveCellsVisited += walkResult.stepsTaken;
        if (walkResult.spot) {
          found = { cx: walkResult.spot.cx, cy: walkResult.spot.cy, steps: walkResult.stepsTaken };
          // Advance cursor past where we landed AND leave a random
          // 0-3 cell forward gap so the aggressive infill leaves
          // organic-looking holes instead of dense unbroken bands.
          const gap = 1 + Math.floor(Math.random() * (AggressiveMaxGapCells + 1));
          ag_gx = walkResult.spot.gx + ag_dx * gap;
          ag_gy = walkResult.spot.gy + ag_dy * gap;
          ag_runLeft -= 1;
          break;
        }
        // Walk failed — force a new run for the next attempt.
        ag_runLeft = 0;
        if (aggressiveCellsVisited >= aggressiveVisitBudget) {
          aggressiveExhausted = true;
          break;
        }
      }
      if (!found) {
        if (aggressiveExhausted) break;
        // Ran out of runs for this placement without finding a spot.
        // The digit is essentially full — bail so caller can grow.
        break;
      }
      cx = found.cx;
      cy = found.cy;
      // walkForFreeSpot checked "inside glyph" only at the cell center and
      // computed overlap with the smallest radius, so we MUST place at
      // that same radius — otherwise we'd overlap neighbours and spill
      // outside the glyph edge.
      r = minCircleSize / 2 + 0.5;
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
 * Walk from grid cell (startGx, startGy) in direction (dirX, dirY) for
 * up to `maxSteps` cells, returning the first cell that is (a) inside
 * the glyph mask and (b) clear of any placed dot at radius `r`.
 *
 * The walk stops early if it steps off the grid — the caller picks a
 * fresh start + direction and calls again. Returning `stepsTaken` lets
 * the caller charge the exhaustion budget accurately.
 *
 * Using a directional walk instead of a row-major linear scan avoids
 * the horizontal-stripe pattern that row-major produces when filling
 * the last few percent of a digit: successive runs land at random
 * (start, direction) pairs so the aggressive-infill dots scatter
 * organically over the remaining space.
 */
function walkForFreeSpot(
  mask: GlyphMask,
  qt: Quadtree,
  r: number,
  maxCircleSize: number,
  startGx: number,
  startGy: number,
  dirX: number,
  dirY: number,
  maxSteps: number,
  step: number,
  cols: number,
  rows: number,
): {
  spot: { cx: number; cy: number; gx: number; gy: number } | null;
  stepsTaken: number;
} {
  const { bounds } = mask;
  let gx = startGx;
  let gy = startGy;
  let steps = 0;
  // Perpendicular of the walk direction. For diagonals this is the
  // other diagonal; for axis-aligned moves this is the other axis.
  // We add a small (-1, 0, +1) perpendicular offset to each stepped
  // cell so runs aren't perfectly straight lines — that pixel-jitter
  // is what actually kills the "stripe" visual artefact.
  const perpX = -dirY;
  const perpY = dirX;
  while (steps < maxSteps) {
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) {
      return { spot: null, stepsTaken: steps };
    }
    // Jitter perpendicular to travel direction: ±1 cell about 60% of
    // the time, no jitter otherwise. Clamp inside grid.
    const j = Math.random();
    const perpOffset = j < 0.3 ? -1 : j < 0.6 ? 1 : 0;
    const jx = clampGrid(gx + perpX * perpOffset, cols);
    const jy = clampGrid(gy + perpY * perpOffset, rows);
    const x = bounds.x + jx * step;
    const y = bounds.y + jy * step;
    steps++;
    if (maskAt(mask, x, y)) {
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
      if (clear) {
        return { spot: { cx: x, cy: y, gx: jx, gy: jy }, stepsTaken: steps };
      }
    }
    gx += dirX;
    gy += dirY;
  }
  return { spot: null, stepsTaken: steps };
}

function clampGrid(v: number, size: number): number {
  return v < 0 ? 0 : v >= size ? size - 1 : v;
}
