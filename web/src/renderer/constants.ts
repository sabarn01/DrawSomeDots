export const TryMultiplyer = 10;
// Padding between adjacent dot edges. Kept small (~2 px) so that at
// SmallestCircleSize=4 and MaxCircleSize=7, packing density stays high
// enough to fit >100k dots per digit at reasonable letter sizes. The
// original C# used a similarly small spacing; earlier ports set this
// to 6 which tripled the effective area per dot and pushed large-N
// letter sizes past MaxLetterSize.
export const INT_Offset = 2;
export const SmallestCircleSize = 4;
export const MaxCircleSize = 7;

export const WidthToHeightFactor = 0.6;

export const InterLetterDelayMs = 300;

export const QuadtreeCapacity = 8;
// Depth 8 caps leaves at 2^8 subdivisions, which is too shallow for the
// giant per-digit canvases produced by very large N (a 10k-pixel-tall
// digit at depth 8 has 40-pixel leaves — those become saturated with
// thousands of dots each and queryCircle degenerates to linear scan).
export const QuadtreeMaxDepth = 14;

// Empirical discount applied to the naive "ink area / circle area" estimate.
// Naive formula assumes 100% packing efficiency; reality (random placement,
// INT_Offset padding, boundary loss on thin strokes) is much lower. This is
// only the initial estimate — DotRenderer grows the letter size if drawDigit
// still can't fit all its dots.
export const PackingCoefficient = 0.42;

// Aggressive grow factor — a single "we didn't fit" restart bumps letter
// size by 40%, so 4 restarts cover a 3.8× range. This trades a bit of
// wasted canvas area for far fewer restarts on badly-calibrated fonts.
export const LetterGrowFactor = 1.4;

// Hard cap on letter size in pixels. A 6000-tall letter at WHF=0.6 is
// 3600 wide → 21.6MP per digit. Seven digits side-by-side is 25200×6000
// = 151MP composite, which is right at the edge of what Chrome/Firefox
// will allocate for a single canvas (~256MP hard limit). Beyond this,
// canvas allocation fails silently on some browsers, so we cap here and
// draw as many dots as fit rather than trying to grow further.
export const MaxLetterSize = 6000;
