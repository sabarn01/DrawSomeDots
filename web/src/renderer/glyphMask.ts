import type { GlyphMask, Rect } from "./types";

/**
 * Draw the given digit character onto an offscreen canvas at the requested
 * letter size, then scan the pixels to build a binary mask of the glyph's
 * inked region plus the bounding rectangle.
 *
 * Font size is chosen dynamically via ctx.measureText so the glyph actually
 * fits the letter box (the C# original used a fixed 1.2x factor and hard-
 * coded offsets that overflowed the box for larger numbers).
 */
export function renderGlyphMask(
  digit: string,
  fontFamily: string,
  letterSize: number,
  letterWidth: number,
): GlyphMask {
  const canvas = new OffscreenCanvas(letterWidth, letterSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, letterWidth, letterSize);
  ctx.fillStyle = "black";
  ctx.textBaseline = "alphabetic";

  drawFittedGlyph(ctx, digit, fontFamily, letterWidth, letterSize, "black");

  const img = ctx.getImageData(0, 0, letterWidth, letterSize);
  const data = img.data;
  const mask = new Uint8Array(letterWidth * letterSize);

  let minX = letterWidth;
  let minY = letterSize;
  let maxX = -1;
  let maxY = -1;

  for (let py = 0; py < letterSize; py++) {
    for (let px = 0; px < letterWidth; px++) {
      const i = (py * letterWidth + px) * 4;
      const dark = data[i] + data[i + 1] + data[i + 2] < 3 * 200;
      if (dark) {
        mask[py * letterWidth + px] = 1;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
  }

  const bounds: Rect =
    maxX < 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  return { mask, width: letterWidth, height: letterSize, bounds };
}

/**
 * Choose a font size such that the digit's actual glyph bounding box fits
 * inside (boxW, boxH) with a small padding, then draw the glyph centered.
 * Uses TextMetrics.actualBoundingBox* which is supported in all modern
 * browsers and Node's OffscreenCanvas equivalents.
 */
export function drawFittedGlyph(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  digit: string,
  fontFamily: string,
  boxW: number,
  boxH: number,
  fillStyle: string,
): void {
  const padding = 0.06; // 6% padding on all sides
  const targetW = boxW * (1 - padding * 2);
  const targetH = boxH * (1 - padding * 2);

  // Start from a font size that would fill the box at typical cap-height and
  // shrink if measurement shows overflow. Cap iterations for safety.
  let fontSize = boxH;
  for (let i = 0; i < 8; i++) {
    ctx.font = `${fontSize}px "${fontFamily}"`;
    const m = ctx.measureText(digit);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (w <= targetW && h <= targetH) break;
    const scale = Math.min(targetW / w, targetH / h);
    if (!isFinite(scale) || scale <= 0) break;
    fontSize *= scale * 0.98;
  }

  ctx.font = `${fontSize}px "${fontFamily}"`;
  const m = ctx.measureText(digit);
  const gW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const gH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // Position so the glyph is centered in the box; baseline is
  // "top + ascent" where top places the ascent line at ascent from the top.
  const originX = (boxW - gW) / 2 + m.actualBoundingBoxLeft;
  const originY = (boxH - gH) / 2 + m.actualBoundingBoxAscent;
  ctx.fillStyle = fillStyle;
  ctx.fillText(digit, originX, originY);
}

export function maskAt(m: GlyphMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
  return m.mask[(y | 0) * m.width + (x | 0)] === 1;
}

/**
 * Count the number of "inked" pixels in a mask — used for fill-percentage
 * measurement.
 */
export function darkPixelCount(m: GlyphMask): number {
  let n = 0;
  for (let i = 0; i < m.mask.length; i++) if (m.mask[i]) n++;
  return n;
}

