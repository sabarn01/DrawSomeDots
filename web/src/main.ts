import { DotRenderer } from "./renderer/DotRenderer";
import { clearFillCache } from "./renderer/distribute";
import { savePng } from "./ui/savePng";
import { View, attachViewInput } from "./ui/view";
import { drawMinimap, attachMinimapInput } from "./ui/minimap";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const numInput = $<HTMLInputElement>("num");
const fontSelect = $<HTMLSelectElement>("font");
const goBtn = $<HTMLButtonElement>("go");
const saveBtn = $<HTMLButtonElement>("save");
const resetViewBtn = $<HTMLButtonElement>("reset-view");
const mainCanvas = $<HTMLCanvasElement>("main");
const minimapCanvas = $<HTMLCanvasElement>("minimap");
const previewCanvas = $<HTMLCanvasElement>("preview");
const previewWrap = $<HTMLDivElement>("preview-wrap");
const canvasWrap = $<HTMLDivElement>("canvas-wrap");
const showMissesCb = $<HTMLInputElement>("show-misses");
const pbLetter = $<HTMLProgressElement>("pb-letter");
const pbLetterTxt = $<HTMLSpanElement>("pb-letter-txt");
const pbTotal = $<HTMLProgressElement>("pb-total");
const pbTotalTxt = $<HTMLSpanElement>("pb-total-txt");
const elapsedEl = $<HTMLSpanElement>("elapsed");
const resizeFlashEl = $<HTMLDivElement>("resize-flash");

// --- View / minimap wiring --------------------------------------------------

const view = new View(mainCanvas);
let currentSource: HTMLCanvasElement | null = null;

view.setOnChange(() => {
  // Any view change (zoom/pan) needs a minimap refresh too.
  scheduleMinimapRedraw();
  updateMinimapVisibility();
});
attachViewInput(view, mainCanvas);
attachMinimapInput(minimapCanvas, view, () => currentSource);
resetViewBtn.addEventListener("click", () => view.reset());

// Make the current-digit preview draggable within #canvas-wrap. The label
// bar is the drag handle so users don't fight the canvas for pointer events
// (the canvas is a no-op passthrough for pointer events, so dragging by
// the canvas itself would still work but land in the underlying #main).
(() => {
  const handle = previewWrap.querySelector<HTMLElement>(".preview-label");
  if (!handle) return;
  let dragging = false;
  let grabDx = 0;
  let grabDy = 0;
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    const wrapRect = canvasWrap.getBoundingClientRect();
    const pvRect = previewWrap.getBoundingClientRect();
    grabDx = e.clientX - pvRect.left;
    grabDy = e.clientY - pvRect.top;
    // Convert whatever positioning it has to left/top so subsequent moves
    // work consistently regardless of any right/bottom values.
    previewWrap.style.left = `${pvRect.left - wrapRect.left}px`;
    previewWrap.style.top = `${pvRect.top - wrapRect.top}px`;
    previewWrap.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const wrapRect = canvasWrap.getBoundingClientRect();
    const w = previewWrap.offsetWidth;
    const h = previewWrap.offsetHeight;
    let nx = e.clientX - wrapRect.left - grabDx;
    let ny = e.clientY - wrapRect.top - grabDy;
    // Clamp so the panel stays fully inside the canvas wrap.
    nx = Math.max(0, Math.min(wrapRect.width - w, nx));
    ny = Math.max(0, Math.min(wrapRect.height - h, ny));
    previewWrap.style.left = `${nx}px`;
    previewWrap.style.top = `${ny}px`;
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    previewWrap.classList.remove("dragging");
    handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
})();

// Handle resizes of the canvas wrap (window resize, DPR change, etc.)
const ro = new ResizeObserver(() => {
  view.resize();
  view.redraw();
  scheduleMinimapRedraw();
});
ro.observe(canvasWrap);
view.resize();

let minimapRedrawScheduled = false;
let lastMinimapDrawAt = 0;
const MinimapMinIntervalMs = 250; // 4 Hz — plenty for a nav overview.
function scheduleMinimapRedraw(): void {
  if (minimapRedrawScheduled) return;
  minimapRedrawScheduled = true;
  const tryDraw = (now: number) => {
    const dt = now - lastMinimapDrawAt;
    if (dt < MinimapMinIntervalMs) {
      // Too soon since the last draw; requeue for later without stealing
      // the whole rAF budget for a nav overlay.
      setTimeout(() => requestAnimationFrame(tryDraw), MinimapMinIntervalMs - dt);
      return;
    }
    minimapRedrawScheduled = false;
    lastMinimapDrawAt = now;
    if (currentSource) {
      drawMinimap(minimapCanvas, currentSource, view.getViewportInSource());
    }
  };
  requestAnimationFrame(tryDraw);
}

function updateMinimapVisibility(): void {
  if (view.isZoomed() && currentSource) {
    minimapCanvas.classList.add("visible");
  } else {
    minimapCanvas.classList.remove("visible");
  }
}

// --- Slider label wiring ----------------------------------------------------

fontSelect.addEventListener("change", () => {
  // Fill percentages depend on the font — invalidate the cache when it changes.
  clearFillCache();
});

// --- Go / Save --------------------------------------------------------------

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
  const elapsedTimer: number = window.setInterval(() => {
    elapsedEl.textContent = `${((performance.now() - start) / 1000).toFixed(2)}s`;
  }, 100);

  try {
    const renderer = new DotRenderer({
      number: n,
      fontFamily: fontSelect.value,
      onLetterProgress: (p) => {
        pbLetter.max = p.total;
        pbLetter.value = p.drawn;
        pbLetterTxt.textContent = `${p.drawn} / ${p.total} (digit ${p.digitIndex + 1})`;
        // Live preview of just the current digit tile — fits its natural
        // size into the small preview canvas. This is what the user watches
        // for progressive rendering; the main canvas stays at fit-to-viewport
        // and only updates on digit completion.
        drawTileIntoPreview(p.canvas, p.attempts);
      },
      onImageProgress: (p) => {
        pbTotal.max = p.totalTarget;
        pbTotal.value = p.totalDrawn;
        pbTotalTxt.textContent = `${p.totalDrawn} / ${p.totalTarget}`;
      },
      onResize: (e) => {
        // Momentary "Resizing" toast so the user sees why the render just
        // restarted at a bigger letter size (rather than thinking it froze).
        resizeFlashEl.textContent = `Resizing → ${e.letterSize}px (digit ${e.digitIndex + 1})`;
        // Restart the CSS animation by toggling the class off and back on.
        resizeFlashEl.classList.remove("flashing");
        // Force reflow so the animation replays even if it was already
        // running from a previous resize a moment ago.
        void resizeFlashEl.offsetWidth;
        resizeFlashEl.classList.add("flashing");
        // The renderer restarts from digit 0 — reset both progress bars
        // so the stale "digit N / M" and total-drawn numbers don't linger
        // on screen while the fresh mask-rendering for digit 0 runs.
        pbLetter.value = 0;
        pbLetter.max = 1;
        pbLetterTxt.textContent = "0 / 0";
        pbTotal.value = 0;
        pbTotalTxt.textContent = `0 / ${pbTotal.max}`;
      },
    });
    currentSource = renderer.renderCanvas;
    view.setSource(currentSource);
    renderer.setOnFrame(() => {
      // Throttle display redraws to animation frames.
      scheduleDisplayRedraw();
    });
    await renderer.run();
    saveBtn.disabled = false;
  } catch (e) {
    console.error(e);
    alert(`Render failed: ${(e as Error).message}`);
  } finally {
    window.clearInterval(elapsedTimer);
    elapsedEl.textContent = `${((performance.now() - start) / 1000).toFixed(2)}s`;
    setControlsDisabled(false);
    running = false;
    view.redraw();
    scheduleMinimapRedraw();
  }
});

let displayRedrawScheduled = false;
function scheduleDisplayRedraw(): void {
  if (displayRedrawScheduled) return;
  displayRedrawScheduled = true;
  requestAnimationFrame(() => {
    displayRedrawScheduled = false;
    view.redraw();
    scheduleMinimapRedraw();
  });
}

saveBtn.addEventListener("click", () => {
  if (!currentSource) return;
  savePng(currentSource, `dots-${numInput.value}.png`);
});

// --- Current-digit preview --------------------------------------------------

const previewCtx = previewCanvas.getContext("2d")!;
function drawTileIntoPreview(
  tile: HTMLCanvasElement | OffscreenCanvas,
  attempts?: ReadonlyArray<{ x: number; y: number; ok: boolean }>,
): void {
  const cw = previewCanvas.width;
  const ch = previewCanvas.height;
  previewCtx.fillStyle = "white";
  previewCtx.fillRect(0, 0, cw, ch);
  if (tile.width === 0 || tile.height === 0) return;
  const scale = Math.min(cw / tile.width, ch / tile.height);
  const dw = tile.width * scale;
  const dh = tile.height * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  previewCtx.imageSmoothingEnabled = scale < 1;
  previewCtx.drawImage(tile, 0, 0, tile.width, tile.height, dx, dy, dw, dh);
  if (attempts && attempts.length) {
    // Overlay recent placement attempts so the user sees where the algorithm
    // is probing. Failed attempts show much more than successes because most
    // probes land in overlap/outside-glyph regions.
    const showMisses = showMissesCb.checked;
    for (const a of attempts) {
      if (!a.ok && !showMisses) continue;
      const ax = dx + a.x * scale;
      const ay = dy + a.y * scale;
      previewCtx.fillStyle = a.ok ? "rgba(0,180,0,0.9)" : "rgba(220,0,0,0.45)";
      previewCtx.beginPath();
      previewCtx.arc(ax, ay, a.ok ? 2 : 1.5, 0, Math.PI * 2);
      previewCtx.fill();
    }
  }
}

function setControlsDisabled(disabled: boolean): void {
  numInput.disabled = disabled;
  fontSelect.disabled = disabled;
  goBtn.disabled = disabled;
}

function resetProgress(n: number): void {
  pbLetter.value = 0;
  pbLetter.max = 1;
  pbLetterTxt.textContent = "0 / 0";
  pbTotal.value = 0;
  pbTotal.max = n;
  pbTotalTxt.textContent = `0 / ${n}`;
  elapsedEl.textContent = "0.00s";
}

// --- Initial number + auto-start ------------------------------------------
// Number source order: URL `?n=` (or `?number=`) param → random in
// [10_000, 100_000). Font source: URL `?font=` param (case-insensitive
// match against the dropdown options) → default. In both cases the 5-second
// countdown + pulse animation runs so the user can still cancel or edit
// before the render starts.
(() => {
  const params = new URLSearchParams(window.location.search);
  const paramN = params.get("n") ?? params.get("number");
  const parsed = paramN != null ? Number.parseInt(paramN, 10) : NaN;
  const initial = Number.isFinite(parsed) && parsed >= 1
    ? parsed
    : 10_000 + Math.floor(Math.random() * 90_000);
  numInput.value = String(initial);

  const paramFont = params.get("font");
  if (paramFont) {
    const match = Array.from(fontSelect.options).find(
      (o) => o.value.toLowerCase() === paramFont.toLowerCase(),
    );
    if (match) fontSelect.value = match.value;
  }

  const autostartBadge = document.getElementById("autostart") as HTMLSpanElement;
  const autostartSecs = document.getElementById("autostart-secs") as HTMLSpanElement;
  const pulseTargets = [numInput, goBtn];
  pulseTargets.forEach((el) => el.classList.add("pulse"));
  autostartBadge.hidden = false;

  const AutoStartMs = 5000;
  const start = performance.now();
  let cancelled = false;

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    pulseTargets.forEach((el) => el.classList.remove("pulse"));
    autostartBadge.hidden = true;
    window.clearInterval(tickTimer);
    window.clearTimeout(fireTimer);
    // Remove listeners so post-render interactions don't retrigger anything.
    cancelListeners.forEach((fn) => fn());
  };

  const tickTimer = window.setInterval(() => {
    const remaining = Math.max(0, AutoStartMs - (performance.now() - start));
    autostartSecs.textContent = Math.ceil(remaining / 1000).toString();
  }, 100);

  const fireTimer = window.setTimeout(() => {
    if (cancelled) return;
    cancel();
    goBtn.click();
  }, AutoStartMs);

  // Only explicit "start/stop" actions cancel the auto-start. Editing the
  // number or changing the font is fine — the auto-start will fire with
  // whatever value is in the field when the timer expires. That way a
  // user who wants to pick a different number can just type it and let
  // the countdown finish, without having to also click Go.
  const cancelEvents: Array<[EventTarget, string]> = [
    [goBtn, "click"],
    [saveBtn, "click"],
    [resetViewBtn, "click"],
  ];
  const cancelListeners: Array<() => void> = cancelEvents.map(([target, ev]) => {
    const handler = (): void => cancel();
    target.addEventListener(ev, handler, { once: true });
    return () => target.removeEventListener(ev, handler);
  });
})();

