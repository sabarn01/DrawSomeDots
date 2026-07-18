export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dot {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface GlyphMask {
  mask: Uint8Array;
  width: number;
  height: number;
  bounds: Rect;
}

export interface LayoutInfo {
  letterSize: number;
  letterWidth: number;
  imageWidth: number;
  imageHeight: number;
}

export interface PlacementAttempt {
  x: number;
  y: number;
  ok: boolean;
}

export interface LetterProgress {
  digitIndex: number;
  drawn: number;
  total: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * A rolling window of recent placement attempts (both successful and
   * failed). Populated by drawDigit so UIs can visualize where the packing
   * algorithm is probing.
   */
  attempts?: ReadonlyArray<PlacementAttempt>;
}

export interface ImageProgress {
  totalDrawn: number;
  totalTarget: number;
  canvas: HTMLCanvasElement;
}

export interface RendererOptions {
  number: number;
  fontFamily: string;
  minCircleSize?: number;
  maxCircleSize?: number;
  interLetterDelayMs?: number;
  onLetterProgress?: (p: LetterProgress) => void;
  onImageProgress?: (p: ImageProgress) => void;
}
