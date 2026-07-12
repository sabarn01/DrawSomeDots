import { DotRenderer } from "./renderer/DotRenderer";
import { clearFillCache } from "./renderer/distribute";
import { savePng } from "./ui/savePng";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const numInput = $<HTMLInputElement>("num");
const fontSelect = $<HTMLSelectElement>("font");
const minSize = $<HTMLInputElement>("min-size");
const maxSize = $<HTMLInputElement>("max-size");
const minVal = $<HTMLSpanElement>("min-val");
const maxVal = $<HTMLSpanElement>("max-val");
const goBtn = $<HTMLButtonElement>("go");
const saveBtn = $<HTMLButtonElement>("save");
const mainCanvas = $<HTMLCanvasElement>("main");
const pbLetter = $<HTMLProgressElement>("pb-letter");
const pbLetterTxt = $<HTMLSpanElement>("pb-letter-txt");
const pbTotal = $<HTMLProgressElement>("pb-total");
const pbTotalTxt = $<HTMLSpanElement>("pb-total-txt");
const elapsedEl = $<HTMLDivElement>("elapsed");

fontSelect.addEventListener("change", () => {
  // Fill percentages depend on the font — invalidate the cache when it changes.
  clearFillCache();
});

// Keep min <= max as the user drags the sliders.
minSize.addEventListener("input", () => {
  if (Number(minSize.value) > Number(maxSize.value)) {
    maxSize.value = minSize.value;
  }
  updateSliderLabels();
});
maxSize.addEventListener("input", () => {
  if (Number(maxSize.value) < Number(minSize.value)) {
    minSize.value = maxSize.value;
  }
  updateSliderLabels();
});

function updateSliderLabels(): void {
  minVal.textContent = minSize.value;
  maxVal.textContent = maxSize.value;
}
updateSliderLabels();

let running = false;

goBtn.addEventListener("click", async () => {
  if (running) return;
  const n = Number.parseInt(numInput.value, 10);
  if (!Number.isFinite(n) || n < 1) {
    alert("Enter a positive integer.");
    return;
  }
  running = true;
  setControlsDisabled(true);
  saveBtn.disabled = true;
  resetProgress(n);

  const start = performance.now();
  let elapsedTimer: number | null = window.setInterval(() => {
    elapsedEl.textContent = `Elapsed: ${((performance.now() - start) / 1000).toFixed(2)}s`;
  }, 100);

  try {
    const renderer = new DotRenderer({
      number: n,
      fontFamily: fontSelect.value,
      minCircleSize: Number(minSize.value),
      maxCircleSize: Number(maxSize.value),
      onLetterProgress: (p) => {
        pbLetter.max = p.total;
        pbLetter.value = p.drawn;
        pbLetterTxt.textContent = `${p.drawn} / ${p.total} (digit ${p.digitIndex + 1})`;
      },
      onImageProgress: (p) => {
        pbTotal.max = p.totalTarget;
        pbTotal.value = p.totalDrawn;
        pbTotalTxt.textContent = `${p.totalDrawn} / ${p.totalTarget}`;
      },
    });
    await renderer.run(mainCanvas);
    saveBtn.disabled = false;
  } catch (e) {
    console.error(e);
    alert(`Render failed: ${(e as Error).message}`);
  } finally {
    if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
    elapsedEl.textContent = `Elapsed: ${((performance.now() - start) / 1000).toFixed(2)}s`;
    setControlsDisabled(false);
    running = false;
  }
});

saveBtn.addEventListener("click", () => {
  savePng(mainCanvas, `dots-${numInput.value}.png`);
});

function setControlsDisabled(disabled: boolean): void {
  numInput.disabled = disabled;
  fontSelect.disabled = disabled;
  minSize.disabled = disabled;
  maxSize.disabled = disabled;
  goBtn.disabled = disabled;
}

function resetProgress(n: number): void {
  pbLetter.value = 0;
  pbLetter.max = 1;
  pbLetterTxt.textContent = "0 / 0";
  pbTotal.value = 0;
  pbTotal.max = n;
  pbTotalTxt.textContent = `0 / ${n}`;
  elapsedEl.textContent = "Elapsed: 0.00s";
  const ctx = mainCanvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
}
