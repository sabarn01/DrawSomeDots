import type { RendererOptions, LayoutInfo, LetterProgress } from "./types";
import { getFillPercentages, distributeDots } from "./distribute";
import { computeLetterSize, growLetterSize, layoutFromLetterSize } from "./layout";
import { renderGlyphMask, drawFittedGlyph } from "./glyphMask";
import { drawDigit } from "./drawDigit";
import { getCalibration, letterSizeFromCalibration, recordPackingObservation } from "./calibrate";
import {
  InterLetterDelayMs,
  MaxCircleSize,
  SmallestCircleSize,
} from "./constants";

export class DotRenderer {
  private readonly opts: RendererOptions;
  private readonly _renderCanvas: HTMLCanvasElement;
  private onFrame?: () => void;

  constructor(opts: RendererOptions) {
    this.opts = opts;
    this._renderCanvas = document.createElement("canvas");
    this._renderCanvas.width = 1;
    this._renderCanvas.height = 1;
  }

  /**
   * The full-resolution offscreen canvas the renderer draws into. UIs (e.g.,
   * View) can read from this at any time; its dimensions match the natural
   * image size, independent of any display scaling.
   */
  get renderCanvas(): HTMLCanvasElement {
    return this._renderCanvas;
  }

  /**
   * Called after every visible update (outline preview, letter progress,
   * digit finish). UIs use this to redraw dependent views (main display,
   * minimap) at their own pace.
   */
  setOnFrame(fn: () => void): void {
    this.onFrame = fn;
  }

  private emitFrame(): void {
    this.onFrame?.();
  }

  async run(): Promise<void> {
    const { number, fontFamily, onImageProgress, onResize } = this.opts;
    const digits = String(number);

    // Wait for the selected font to be ready so metrics/masks are stable.
    if (typeof document !== "undefined" && document.fonts) {
      try {
        await document.fonts.load(`16px "${fontFamily}"`);
        await document.fonts.ready;
      } catch {
        // Non-fatal: proceed with whatever font the browser picks.
      }
    }

    const fills = getFillPercentages(fontFamily);
    const minCircleSize = Math.max(1, this.opts.minCircleSize ?? SmallestCircleSize);
    const maxCircleSize = Math.max(minCircleSize, this.opts.maxCircleSize ?? MaxCircleSize);
    // Prefer the multi-size packing-capacity measurement from
    // calibration so digits get a share of N proportional to how many
    // dots they can actually hold — not to how many ink pixels they
    // have. Ink pixels are a poor proxy: a "1" has lots of ink for its
    // width but poor packing (thin stroke), while an "8" packs
    // efficiently in its bowls. Falls back to the single-size ink
    // fraction if calibration is unavailable.
    let perDigit: number[];
    let layout: LayoutInfo;
    try {
      const cal = await getCalibration(fontFamily);
      perDigit = distributeDots(number, cal.dotsPerPixel);
      const letterSize = letterSizeFromCalibration(number, perDigit, digits, cal);
      layout = layoutFromLetterSize(letterSize, digits.length);
    } catch {
      perDigit = distributeDots(number, fills);
      layout = computeLetterSize(number, fills, minCircleSize, maxCircleSize);
    }

    this.sizeRenderCanvas(layout);
    this.paintOutlinePreview(digits, fontFamily, layout);
    this.emitFrame();
    // Yield once so the browser paints the outline preview before we start
    // the (potentially long) first-digit mask + placement work.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });

    // Outer restart loop: if any digit fails to fit its dot allotment at
    // the current letter size, we grow the letter size and restart the
    // whole render from digit 0. This keeps every digit rendered exactly
    // once at the final size (no upscaled tiles, uniform density across
    // the number), and it also updates the calibration so future runs
    // skip the grow entirely.
    let totalDrawn = 0;
    let placedTiles: HTMLCanvasElement[] = [];
    let restartsRemaining = 4;
    let attemptNumber = 0;
    outer: while (true) {
      attemptNumber++;
      totalDrawn = 0;
      placedTiles = [];
      this.sizeRenderCanvas(layout);
      this.paintOutlinePreview(digits, fontFamily, layout);
      this.emitFrame();

      for (let i = 0; i < digits.length; i++) {
        const ch = digits[i];
        const alloc = perDigit[i];

        const mask = renderGlyphMask(
          ch,
          fontFamily,
          layout.letterSize,
          layout.letterWidth,
        );
        const result = await drawDigit({
          digit: ch,
          fontFamily,
          letterSize: layout.letterSize,
          letterWidth: layout.letterWidth,
          numDots: alloc,
          digitIndex: i,
          minCircleSize,
          maxCircleSize,
          mask,
          onProgress: this.forwardLetterProgress(i, alloc),
          yieldFn: yieldToBrowser,
        });

        if (result.unplaced > 0) {
          // Feed the observed ceiling back into calibration so future
          // runs of this font pick a larger letter size for this digit
          // and skip the restart entirely.
          recordPackingObservation(
            fontFamily,
            Number(ch),
            layout.letterSize,
            layout.letterWidth,
            result.placed,
            false,
          );
          const grown = growLetterSize(layout, digits.length);
          // If growLetterSize couldn't actually grow (clamped at
          // MaxLetterSize), further restarts would do identical work.
          // Commit what we have and continue with the next digits at
          // the same capped size — they may still succeed on their own
          // if their allotment is smaller.
          if (grown.letterSize <= layout.letterSize || restartsRemaining <= 0) {
            const ctx = this._renderCanvas.getContext("2d")!;
            ctx.drawImage(result.canvas, layout.letterWidth * i, 0);
            placedTiles.push(result.canvas);
            totalDrawn += result.placed;
            this.emitFrame();
            onImageProgress?.({
              totalDrawn,
              totalTarget: number,
              canvas: this._renderCanvas,
            });
            if (i < digits.length - 1) {
              await sleep(this.opts.interLetterDelayMs ?? InterLetterDelayMs);
            }
            continue; // move on to next digit; do NOT restart
          }
          restartsRemaining--;
          layout = grown;
          onResize?.({
            digitIndex: i,
            letterSize: grown.letterSize,
            attempt: attemptNumber,
          });
          continue outer;
        }

        // Compose the finished digit onto the full-res render canvas.
        const ctx = this._renderCanvas.getContext("2d")!;
        ctx.drawImage(result.canvas, layout.letterWidth * i, 0);
        placedTiles.push(result.canvas);
        totalDrawn += result.placed;
        this.emitFrame();
        onImageProgress?.({
          totalDrawn,
          totalTarget: number,
          canvas: this._renderCanvas,
        });

        if (i < digits.length - 1) {
          await sleep(this.opts.interLetterDelayMs ?? InterLetterDelayMs);
        }
      }
      break; // all digits rendered successfully at the current size
    }
  }

  private sizeRenderCanvas(layout: LayoutInfo): void {
    if (
      this._renderCanvas.width !== layout.imageWidth ||
      this._renderCanvas.height !== layout.imageHeight
    ) {
      this._renderCanvas.width = layout.imageWidth;
      this._renderCanvas.height = layout.imageHeight;
      const ctx = this._renderCanvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, this._renderCanvas.width, this._renderCanvas.height);
    }
  }

  /**
   * Paint faint outlines of every digit onto the render canvas so the
   * number's shape is visible immediately, before any dots land.
   */
  private paintOutlinePreview(
    digits: string,
    fontFamily: string,
    layout: LayoutInfo,
  ): void {
    const ctx = this._renderCanvas.getContext("2d")!;
    for (let i = 0; i < digits.length; i++) {
      ctx.save();
      ctx.translate(layout.letterWidth * i, 0);
      drawFittedGlyph(
        ctx,
        digits[i],
        fontFamily,
        layout.letterWidth,
        layout.letterSize,
        "white",
      );
      ctx.restore();
    }
  }

  private forwardLetterProgress(
    digitIndex: number,
    total: number,
  ): (p: LetterProgress) => void {
    return (p) => {
      // Per-dot live rendering goes to the caller (main.ts uses this to paint
      // a small dedicated "current digit" canvas). We deliberately do NOT
      // blit the in-progress tile back onto the full render canvas here —
      // for large N that tile can be tens of megapixels, and blitting it +
      // repainting the display 60x/second stalls progressive rendering.
      // The tile is composed onto the render canvas once, when the digit
      // completes (see run()).
      this.opts.onLetterProgress?.({ ...p, total, digitIndex });
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
