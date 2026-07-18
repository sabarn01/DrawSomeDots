import type { Rect } from "../renderer/types";

/**
 * Interactive view over a source canvas. Manages a scale + pan transform,
 * composits the visible region of the source into a display canvas, and
 * exposes hooks so the caller can wire up input (wheel, drag, keyboard,
 * minimap) without View knowing about DOM events itself.
 *
 * Coordinates:
 *  - Source coords: pixels in the underlying `source` canvas (0..source.width, 0..source.height).
 *  - Display coords: CSS pixels in the display canvas (0..display.clientWidth, 0..display.clientHeight).
 *  - Backing pixels: display.width/height = displayCss * devicePixelRatio.
 *
 * Transform: displayPoint = sourcePoint * scale + pan
 *            sourcePoint  = (displayPoint - pan) / scale
 */
export class View {
  private readonly display: HTMLCanvasElement;
  private source: HTMLCanvasElement | null = null;

  private scale = 1;
  private panX = 0;
  private panY = 0;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  private autoFit = true;
  private lastFitW = 0;
  private lastFitH = 0;
  private minVisibleDotScale = 0;
  private focusSrcX: number | null = null;
  private focusSrcY: number | null = null;

  private onChange?: () => void;

  constructor(display: HTMLCanvasElement) {
    this.display = display;
  }

  setSource(canvas: HTMLCanvasElement): void {
    this.source = canvas;
    this.autoFit = true;
    this.lastFitW = 0;
    this.lastFitH = 0;
    this.focusSrcX = null;
    this.focusSrcY = null;
    // Only fit immediately if the source has real dimensions. Otherwise
    // (e.g. the renderer's initial 1×1 placeholder canvas), skip the
    // fit — the auto-refit inside redraw() will handle it as soon as the
    // renderer resizes the canvas to its real layout size.
    if (canvas.width > 4 && canvas.height > 4) {
      this.reset();
    }
    this.redraw();
  }

  /**
   * Minimum on-screen size (in CSS pixels) of one source pixel we should
   * allow during auto-fit. If fit-to-viewport would scale below this we
   * clamp scale upward so individual dots stay visible; the user can still
   * manually zoom out past fit if they want to see the whole thing.
   *
   * Callers should set this to ~2 / maxCircleSize so that a dot of the
   * largest possible radius is at least 2 CSS pixels wide.
   */
  setMinVisibleDotScale(scale: number): void {
    this.minVisibleDotScale = Math.max(0, scale);
    if (this.autoFit && this.source) {
      // Re-apply fit with the new clamp.
      this.lastFitW = 0;
      this.lastFitH = 0;
      this.redraw();
      this.onChange?.();
    }
  }

  /**
   * While auto-fit is active, keep this source-space point centered in the
   * display (clamped by pan bounds). Used by the renderer to follow the
   * currently-active digit so users can watch it fill in even when the
   * total canvas is far bigger than the viewport.
   *
   * A null coordinate leaves that axis un-focused (canvas-centered fallback).
   */
  focusAt(sourceX: number | null, sourceY: number | null): void {
    this.focusSrcX = sourceX;
    this.focusSrcY = sourceY;
    if (this.autoFit) {
      this.applyAutoFitPan();
      this.notify();
    }
  }

  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  /**
   * Re-read the display canvas's CSS size and devicePixelRatio and resize
   * its backing store accordingly. Preserves scale/pan (re-clamped).
   */
  resize(): void {
    const rect = this.display.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, Math.floor(rect.width));
    this.cssH = Math.max(1, Math.floor(rect.height));
    const bw = Math.floor(this.cssW * this.dpr);
    const bh = Math.floor(this.cssH * this.dpr);
    if (this.display.width !== bw || this.display.height !== bh) {
      this.display.width = bw;
      this.display.height = bh;
    }
    // If auto-fit is still active, the viewport just changed size — force
    // the next redraw() to recompute the fit scale + pan for the new
    // viewport. Without this, resizing the window while auto-fit is on
    // leaves the image at the old scale (cropped when shrinking,
    // orphaned in a corner when growing).
    if (this.autoFit) {
      this.lastFitW = -1;
      this.lastFitH = -1;
    }
    this.clampPan();
  }

  /** Zoom around a point given in display CSS coordinates. */
  zoomAt(cssX: number, cssY: number, factor: number): void {
    const oldScale = this.scale;
    const newScale = clamp(oldScale * factor, this.minScale(), this.maxScale());
    if (newScale === oldScale) return;
    // Keep the source-point under the cursor fixed:
    // panNew = cursor - (cursor - panOld) * (newScale / oldScale)
    const ratio = newScale / oldScale;
    this.panX = cssX - (cssX - this.panX) * ratio;
    this.panY = cssY - (cssY - this.panY) * ratio;
    this.scale = newScale;
    this.autoFit = false;
    this.clampPan();
    this.notify();
  }

  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.panX += dx;
    this.panY += dy;
    this.autoFit = false;
    this.clampPan();
    this.notify();
  }

  /** Center the view (in source coords) on the given source-space point. */
  centerOn(srcX: number, srcY: number): void {
    this.panX = this.cssW / 2 - srcX * this.scale;
    this.panY = this.cssH / 2 - srcY * this.scale;
    this.clampPan();
    this.notify();
  }

  /** Reset to fit-to-view (whole source visible, centered). */
  reset(): void {
    if (!this.source) return;
    this.scale = this.autoFitScale();
    this.autoFit = true;
    this.lastFitW = this.source.width;
    this.lastFitH = this.source.height;
    this.applyAutoFitPan();
    this.notify();
  }

  /**
   * Return the visible region of the source canvas in source coordinates,
   * clamped to the source bounds. Used by the minimap to draw the viewport
   * rectangle.
   */
  getViewportInSource(): Rect {
    if (!this.source) return { x: 0, y: 0, width: 0, height: 0 };
    const x = -this.panX / this.scale;
    const y = -this.panY / this.scale;
    const w = this.cssW / this.scale;
    const h = this.cssH / this.scale;
    return clampRectToBounds(
      { x, y, width: w, height: h },
      { x: 0, y: 0, width: this.source.width, height: this.source.height },
    );
  }

  /** Whether the view is zoomed in beyond fit-to-view. */
  isZoomed(): boolean {
    return this.scale > this.fitScale() + 1e-4;
  }

  displayToSource(cssX: number, cssY: number): { x: number; y: number } {
    return {
      x: (cssX - this.panX) / this.scale,
      y: (cssY - this.panY) / this.scale,
    };
  }

  /**
   * Redraw the display canvas: white background, source scaled/panned into
   * position. Uses image smoothing for smooth zoom-out and nearest-neighbor
   * for zoom-in past 4x so individual dots stay crisp.
   */
  redraw(): void {
    if (!this.source) return;
    // Auto-refit if the user hasn't manually zoomed/panned and the source
    // dimensions have changed since the last fit (e.g. the renderer's
    // initial 1×1 canvas grew to its layout size, or grow-and-retry resized it).
    if (
      this.autoFit &&
      (this.source.width !== this.lastFitW || this.source.height !== this.lastFitH)
    ) {
      this.scale = this.autoFitScale();
      this.lastFitW = this.source.width;
      this.lastFitH = this.source.height;
      this.applyAutoFitPan();
    } else if (this.autoFit && (this.focusSrcX !== null || this.focusSrcY !== null)) {
      this.applyAutoFitPan();
    }
    const ctx = this.display.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.imageSmoothingEnabled = this.scale < 4;
    // Only blit the visible portion of the source. Otherwise, at multi-
    // megapixel source sizes (e.g. 30k × 10k for 7-digit N), the browser
    // has to composite the whole thing every frame and progressive
    // rendering stalls.
    const srcW = this.source.width;
    const srcH = this.source.height;
    const visSx = Math.max(0, -this.panX / this.scale);
    const visSy = Math.max(0, -this.panY / this.scale);
    const visSx2 = Math.min(srcW, (this.cssW - this.panX) / this.scale);
    const visSy2 = Math.min(srcH, (this.cssH - this.panY) / this.scale);
    const visSw = visSx2 - visSx;
    const visSh = visSy2 - visSy;
    if (visSw > 0 && visSh > 0) {
      const dstX = visSx * this.scale + this.panX;
      const dstY = visSy * this.scale + this.panY;
      const dstW = visSw * this.scale;
      const dstH = visSh * this.scale;
      ctx.drawImage(
        this.source,
        visSx, visSy, visSw, visSh,
        dstX, dstY, dstW, dstH,
      );
    }
    ctx.restore();
  }

  private fitScale(): number {
    if (!this.source) return 1;
    if (this.source.width === 0 || this.source.height === 0) return 1;
    return Math.min(
      this.cssW / this.source.width,
      this.cssH / this.source.height,
    );
  }

  /**
   * Auto-fit scale used by reset() and by auto-refit inside redraw(). Same
   * as fitScale() but clamped upward so individual dots stay visible; if
   * the whole source can't fit at that scale, the user must zoom out
   * manually (allowed down to minScale = fitScale * 0.95).
   */
  private autoFitScale(): number {
    return Math.max(this.fitScale(), this.minVisibleDotScale);
  }

  /**
   * Compute pan for auto-fit mode: center the focus point (if any) in the
   * display, otherwise center the whole source. Then clamp to bounds.
   */
  private applyAutoFitPan(): void {
    if (!this.source) return;
    if (this.focusSrcX !== null) {
      this.panX = this.cssW / 2 - this.focusSrcX * this.scale;
    } else {
      this.panX = (this.cssW - this.source.width * this.scale) / 2;
    }
    if (this.focusSrcY !== null) {
      this.panY = this.cssH / 2 - this.focusSrcY * this.scale;
    } else {
      this.panY = (this.cssH - this.source.height * this.scale) / 2;
    }
    this.clampPan();
  }

  private minScale(): number {
    return this.fitScale() * 0.95;
  }

  private maxScale(): number {
    // Zoom until 1 source pixel ≈ 40 CSS pixels, or 32× fit, whichever larger.
    return Math.max(40, this.fitScale() * 32);
  }

  private clampPan(): void {
    if (!this.source) return;
    const srcW = this.source.width * this.scale;
    const srcH = this.source.height * this.scale;
    if (srcW <= this.cssW) {
      // Center horizontally when source fits.
      this.panX = (this.cssW - srcW) / 2;
    } else {
      const maxPan = 0;
      const minPan = this.cssW - srcW;
      this.panX = clamp(this.panX, minPan, maxPan);
    }
    if (srcH <= this.cssH) {
      this.panY = (this.cssH - srcH) / 2;
    } else {
      const maxPan = 0;
      const minPan = this.cssH - srcH;
      this.panY = clamp(this.panY, minPan, maxPan);
    }
  }

  private notify(): void {
    this.redraw();
    this.onChange?.();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function clampRectToBounds(r: Rect, b: Rect): Rect {
  const x1 = Math.max(r.x, b.x);
  const y1 = Math.max(r.y, b.y);
  const x2 = Math.min(r.x + r.width, b.x + b.width);
  const y2 = Math.min(r.y + r.height, b.y + b.height);
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

/** Wire up wheel / pointer / keyboard / dblclick on the display canvas. */
export function attachViewInput(view: View, display: HTMLCanvasElement): void {
  display.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = display.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    // Normalize delta across browsers/trackpads.
    const factor = Math.pow(1.0015, -e.deltaY);
    view.zoomAt(cssX, cssY, factor);
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  display.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    display.setPointerCapture(e.pointerId);
    display.focus();
  });
  display.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    view.panBy(dx, dy);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    display.releasePointerCapture(e.pointerId);
  };
  display.addEventListener("pointerup", endDrag);
  display.addEventListener("pointercancel", endDrag);

  display.addEventListener("dblclick", () => view.reset());

  display.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 160 : 40;
    switch (e.key) {
      case "ArrowLeft": view.panBy(step, 0); e.preventDefault(); break;
      case "ArrowRight": view.panBy(-step, 0); e.preventDefault(); break;
      case "ArrowUp": view.panBy(0, step); e.preventDefault(); break;
      case "ArrowDown": view.panBy(0, -step); e.preventDefault(); break;
      case "0":
      case "Home":
        view.reset();
        e.preventDefault();
        break;
    }
  });
}
