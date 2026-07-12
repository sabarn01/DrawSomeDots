import type { Dot, GlyphMask, LetterProgress } from "./types";
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
  drawFittedGlyph(ctx, digit, fontFamily, letterWidth, letterSize, "rgba(0,0,0,0.05)");
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
  // linearly for a free spot. Scanning always from top-left produces an
  // ugly stripe pattern; instead we start each aggressive-infill run at a
  // random (x, y) within the glyph bounds and pick a fresh start every
  // AggressiveResetEvery dots so the infill looks organic.
  const AggressiveResetEvery = 20;
  let aggressiveCount = 0;
  let scanStartX = bounds.x;
  let scanStartY = bounds.y;
  const pickScanStart = (): void => {
    scanStartX = randInt(bounds.x, bounds.x + bounds.width);
    scanStartY = randInt(bounds.y, bounds.y + bounds.height);
  };

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

  while (placed < target) {
    // Choose radius: full range while we have budget, shrink to smallest when
    // we've used more than TryMultiplyer * target attempts.
    const rMax =
      tryCount < maxTries ? maxCircleSize : minCircleSize;
    const rMin = minCircleSize;
    const r = randInt(rMin, rMax + 1) / 2 + 0.5; // radius in pixels

    let attemptedThisDot = 0;
    let accepted = false;
    let cx = 0;
    let cy = 0;
    while (attemptedThisDot < 40) {
      attemptedThisDot++;
      tryCount++;
      cx = randInt(bounds.x, bounds.x + bounds.width);
      cy = randInt(bounds.y, bounds.y + bounds.height);
      if (!isInsideGlyph(cx, cy, r)) continue;
      if (overlaps(cx, cy, r)) continue;
      accepted = true;
      break;
    }

    if (!accepted) {
      // Fallback: scan the mask for any free spot, starting from a random
      // point that we refresh every AggressiveResetEvery dots. Without this
      // the fallback packs dots into one corner as a stripe pattern.
      if (aggressiveCount % AggressiveResetEvery === 0) {
        pickScanStart();
      }
      aggressiveCount++;
      const found = findAnyFreeSpot(
        mask,
        qt,
        minCircleSize / 2 + 0.5,
        maxCircleSize,
        scanStartX,
        scanStartY,
      );
      if (!found) {
        break; // give up; caller will grow letter size and retry
      }
      cx = found.cx;
      cy = found.cy;
    } else {
      // Reset aggressive-infill state whenever a random placement succeeds,
      // so a fresh run of failures picks a fresh start point.
      aggressiveCount = 0;
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

    // Time-based progress + yield: fire an update and hand the event loop
    // back to the browser whenever a frame's worth of time has elapsed.
    // This makes the digit visibly build up dot-by-dot for small N and
    // still runs smoothly for large N.
    const now = performance.now();
    if (now - lastYield >= FrameBudgetMs) {
      onProgress?.({ digitIndex, drawn: placed, total: target, canvas });
      if (yieldFn) await yieldFn();
      lastYield = performance.now();
    }
  }

  if (onProgress) {
    onProgress({ digitIndex, drawn: placed, total: target, canvas });
  }

  return { canvas, placed, unplaced: target - placed };
}

/**
 * Scan the glyph mask for a point that satisfies both "inside glyph" and
 * "clear of any placed dot", starting from (startX, startY) and wrapping
 * modulo the bounds so the whole mask is covered exactly once.
 *
 * Used as a last-resort placement when random sampling has exhausted its
 * budget. Returns null if no such point exists.
 */
function findAnyFreeSpot(
  mask: GlyphMask,
  qt: Quadtree,
  r: number,
  maxCircleSize: number,
  startX: number,
  startY: number,
): { cx: number; cy: number } | null {
  const { bounds } = mask;
  const step = Math.max(1, Math.floor(r));
  const rows = Math.max(1, Math.floor(bounds.height / step));
  const cols = Math.max(1, Math.floor(bounds.width / step));
  const offX = Math.max(0, Math.floor((startX - bounds.x) / step));
  const offY = Math.max(0, Math.floor((startY - bounds.y) / step));
  for (let dy = 0; dy < rows; dy++) {
    const gy = (dy + offY) % rows;
    const y = bounds.y + gy * step;
    for (let dx = 0; dx < cols; dx++) {
      const gx = (dx + offX) % cols;
      const x = bounds.x + gx * step;
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
      if (clear) return { cx: x, cy: y };
    }
  }
  return null;
}
