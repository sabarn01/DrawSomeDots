import type { Rect } from "../renderer/types";
import type { View } from "./view";

/**
 * Draw the minimap: a down-scaled preview of the source canvas with a red
 * rectangle outlining the current viewport. Manages DPR-aware backing store
 * so the preview is crisp on HiDPI displays.
 */
export function drawMinimap(
  dest: HTMLCanvasElement,
  source: HTMLCanvasElement,
  viewportInSource: Rect,
): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = dest.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  const bw = Math.floor(cssW * dpr);
  const bh = Math.floor(cssH * dpr);
  if (dest.width !== bw || dest.height !== bh) {
    dest.width = bw;
    dest.height = bh;
  }
  const ctx = dest.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(0, 0, cssW, cssH);
  if (source.width === 0 || source.height === 0) return;

  const scale = Math.min(cssW / source.width, cssH / source.height);
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  const offX = (cssW - drawW) / 2;
  const offY = (cssH - drawH) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, offX, offY, drawW, drawH);

  // Viewport rectangle
  ctx.strokeStyle = "#e11";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    offX + viewportInSource.x * scale,
    offY + viewportInSource.y * scale,
    Math.max(2, viewportInSource.width * scale),
    Math.max(2, viewportInSource.height * scale),
  );
}

/**
 * Convert a minimap CSS point to a source coordinate. Returns null if the
 * click was in the letterbox padding (outside the source area).
 */
function minimapToSource(
  dest: HTMLCanvasElement,
  source: HTMLCanvasElement,
  cssX: number,
  cssY: number,
): { x: number; y: number } | null {
  const rect = dest.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  if (source.width === 0 || source.height === 0) return null;
  const scale = Math.min(cssW / source.width, cssH / source.height);
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  const offX = (cssW - drawW) / 2;
  const offY = (cssH - drawH) / 2;
  const localX = cssX - offX;
  const localY = cssY - offY;
  if (localX < 0 || localY < 0 || localX > drawW || localY > drawH) return null;
  return { x: localX / scale, y: localY / scale };
}

/**
 * Wire up click/drag on the minimap: recenter the View on the source point
 * under the pointer.
 */
export function attachMinimapInput(
  minimap: HTMLCanvasElement,
  view: View,
  getSource: () => HTMLCanvasElement | null,
): void {
  let dragging = false;
  const handle = (e: PointerEvent) => {
    const src = getSource();
    if (!src) return;
    const rect = minimap.getBoundingClientRect();
    const p = minimapToSource(minimap, src, e.clientX - rect.left, e.clientY - rect.top);
    if (!p) return;
    view.centerOn(p.x, p.y);
  };
  minimap.addEventListener("pointerdown", (e) => {
    dragging = true;
    minimap.setPointerCapture(e.pointerId);
    handle(e);
    e.preventDefault();
  });
  minimap.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    handle(e);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    minimap.releasePointerCapture(e.pointerId);
  };
  minimap.addEventListener("pointerup", endDrag);
  minimap.addEventListener("pointercancel", endDrag);
  // Swallow wheel so it doesn't scroll the page over the minimap.
  minimap.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
}
