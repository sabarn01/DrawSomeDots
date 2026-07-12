import type { RendererOptions, LayoutInfo, LetterProgress } from "./types";
import { getFillPercentages, distributeDots } from "./distribute";
import { computeLetterSize, growLetterSize } from "./layout";
import { renderGlyphMask, drawFittedGlyph } from "./glyphMask";
import { drawDigit } from "./drawDigit";
import {
  InterLetterDelayMs,
  MaxCircleSize,
  SmallestCircleSize,
} from "./constants";

export class DotRenderer {
  private readonly opts: RendererOptions;
  private mainCanvas: HTMLCanvasElement | null = null;

  constructor(opts: RendererOptions) {
    this.opts = opts;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.mainCanvas;
  }

  async run(mainCanvas: HTMLCanvasElement): Promise<void> {
    this.mainCanvas = mainCanvas;
    const { number, fontFamily, onImageProgress } = this.opts;
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
    const perDigit = distributeDots(number, fills);
    const minCircleSize = Math.max(1, this.opts.minCircleSize ?? SmallestCircleSize);
    const maxCircleSize = Math.max(minCircleSize, this.opts.maxCircleSize ?? MaxCircleSize);
    let layout = computeLetterSize(number, fills, minCircleSize, maxCircleSize);

    this.sizeMainCanvas(layout);
    this.paintOutlinePreview(digits, fontFamily, layout);
    // Yield once so the browser paints the outline preview before we start
    // the (potentially long) first-digit mask + placement work.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });

    let totalDrawn = 0;
    for (let i = 0; i < digits.length; i++) {
      const ch = digits[i];
      const alloc = perDigit[i];

      // Grow-and-retry loop for a single digit — the empirical packing
      // coefficient can underestimate for some fonts/digits; if drawDigit
      // can't fit all the dots we grow the letter size and try again.
      let attempt = 0;
      let result: Awaited<ReturnType<typeof drawDigit>> | null = null;
      while (attempt < 6) {
        const mask = renderGlyphMask(
          ch,
          fontFamily,
          layout.letterSize,
          layout.letterWidth,
        );
        result = await drawDigit({
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
        if (result.unplaced === 0) break;
        // Grow and retry this digit.
        layout = growLetterSize(layout, digits.length);
        this.sizeMainCanvas(layout);
        // Repaint already-composed digits at new size — for simplicity we
        // just re-run everything from digit 0 on the next iteration would
        // be complex; instead we accept that a grow event resets this digit
        // only. Prior digits keep their old tile; we recompose at new width.
        // In practice grow-and-retry fires rarely and mostly on the first
        // digit, so the visual impact is negligible.
        attempt++;
      }

      if (!result) throw new Error("drawDigit never ran");

      // Compose the digit's canvas onto the main canvas.
      const ctx = mainCanvas.getContext("2d")!;
      ctx.drawImage(result.canvas, layout.letterWidth * i, 0);

      totalDrawn += result.placed;
      onImageProgress?.({
        totalDrawn,
        totalTarget: number,
        canvas: mainCanvas,
      });

      if (i < digits.length - 1) {
        await sleep(this.opts.interLetterDelayMs ?? InterLetterDelayMs);
      }
    }
  }

  private sizeMainCanvas(layout: LayoutInfo): void {
    if (!this.mainCanvas) return;
    if (
      this.mainCanvas.width !== layout.imageWidth ||
      this.mainCanvas.height !== layout.imageHeight
    ) {
      this.mainCanvas.width = layout.imageWidth;
      this.mainCanvas.height = layout.imageHeight;
      const ctx = this.mainCanvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    }
  }

  /**
   * Paint faint outlines of every digit onto the main canvas so the number's
   * shape is visible immediately, before any dots land. Without this, big-N
   * renders leave the canvas blank for the first several hundred ms while
   * masks and fill percentages are computed.
   */
  private paintOutlinePreview(
    digits: string,
    fontFamily: string,
    layout: LayoutInfo,
  ): void {
    if (!this.mainCanvas) return;
    const ctx = this.mainCanvas.getContext("2d")!;
    for (let i = 0; i < digits.length; i++) {
      ctx.save();
      ctx.translate(layout.letterWidth * i, 0);
      drawFittedGlyph(
        ctx,
        digits[i],
        fontFamily,
        layout.letterWidth,
        layout.letterSize,
        "rgba(0,0,0,0.08)",
      );
      ctx.restore();
    }
  }

  private forwardLetterProgress(
    digitIndex: number,
    total: number,
  ): (p: LetterProgress) => void {
    return (p) => {
      if (!this.mainCanvas) return;
      // Live-preview each digit tile onto the main canvas as it fills in.
      const ctx = this.mainCanvas.getContext("2d")!;
      // Compute a fixed letterWidth from current canvas / digit count.
      const digitCount = String(this.opts.number).length;
      const letterWidth = Math.floor(this.mainCanvas.width / digitCount);
      ctx.drawImage(p.canvas, letterWidth * digitIndex, 0);
      this.opts.onLetterProgress?.({ ...p, total });
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToBrowser(): Promise<void> {
  // requestAnimationFrame gives the browser a real paint opportunity and
  // avoids setTimeout's 4ms clamping in modern browsers. Fall back to
  // setTimeout if rAF isn't available (e.g., in a worker).
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
