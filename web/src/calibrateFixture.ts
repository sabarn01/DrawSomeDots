// Calibration fixture. Exposes window.__runCalibration for the Playwright
// script to invoke. Runs the real drawDigit against each digit at several
// letter sizes for each font, and returns the maximum non-overlapping dot
// count achieved (i.e., the true packing capacity).
//
// This runs the SAME code path the app uses at runtime, so the resulting
// per-digit dotsPerPixel numbers should reflect exactly what production
// rendering can achieve — no more grid-with-jitter approximation.

import { drawDigit } from "./renderer/drawDigit";
import { renderGlyphMask } from "./renderer/glyphMask";
import {
  SmallestCircleSize,
  MaxCircleSize,
  WidthToHeightFactor,
} from "./renderer/constants";

export interface CalibResult {
  font: string;
  perDigit: {
    digit: number;
    perSize: { size: number; letterWidth: number; placed: number; dotsPerPixel: number }[];
  }[];
}

async function ensureFont(font: string): Promise<void> {
  if (document.fonts) {
    try {
      await document.fonts.load(`16px "${font}"`);
      await document.fonts.ready;
    } catch {
      // best-effort
    }
  }
}

async function measure(font: string, sizes: number[], log: (s: string) => void): Promise<CalibResult> {
  await ensureFont(font);
  // Stochastic placement is noisy — a single drawDigit run can bail early
  // if aggressive-infill happens to burn its visit budget on unlucky
  // walk starts. Take the MAX placed across a handful of runs to
  // approximate the true packing ceiling. Increasing this trades
  // linearly more calibration time for a tighter ceiling.
  const RepeatsPerCombo = 5;
  const perDigit: CalibResult["perDigit"] = [];
  for (let d = 0; d <= 9; d++) {
    const perSize: { size: number; letterWidth: number; placed: number; dotsPerPixel: number }[] = [];
    for (const size of sizes) {
      const letterWidth = Math.round(size * WidthToHeightFactor);
      const mask = renderGlyphMask(String(d), font, size, letterWidth);
      const target = Math.max(200, Math.ceil(size * letterWidth * 0.2));
      let bestPlaced = 0;
      for (let rep = 0; rep < RepeatsPerCombo; rep++) {
        const result = await drawDigit({
          digit: String(d),
          fontFamily: font,
          letterSize: size,
          letterWidth,
          numDots: target,
          digitIndex: 0,
          minCircleSize: SmallestCircleSize,
          maxCircleSize: MaxCircleSize,
          mask,
          yieldFn: () => new Promise((r) => setTimeout(r, 0)),
        });
        if (result.placed > bestPlaced) bestPlaced = result.placed;
      }
      const dpp = bestPlaced / (size * letterWidth);
      perSize.push({ size, letterWidth, placed: bestPlaced, dotsPerPixel: dpp });
      log(`  ${font} d=${d} size=${size} best=${bestPlaced} dpp=${dpp.toFixed(6)}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    perDigit.push({ digit: d, perSize });
  }
  return { font, perDigit };
}

declare global {
  interface Window {
    __runCalibration: (fonts: string[], sizes: number[]) => Promise<CalibResult[]>;
  }
}

const logEl = document.getElementById("log") as HTMLPreElement | null;
function log(s: string): void {
  if (logEl) logEl.textContent = (logEl.textContent ?? "") + s + "\n";
  console.log(s);
}

window.__runCalibration = async (fonts: string[], sizes: number[]) => {
  const out: CalibResult[] = [];
  for (const font of fonts) {
    log(`\n== ${font} ==`);
    const r = await measure(font, sizes, log);
    out.push(r);
  }
  log("\nDONE");
  return out;
};
