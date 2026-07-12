export const TryMultiplyer = 10;
export const INT_Offset = 6;
export const SmallestCircleSize = 4;
export const MaxCircleSize = 7;

export const WidthToHeightFactor = 0.6;

export const InterLetterDelayMs = 300;

export const QuadtreeCapacity = 8;
export const QuadtreeMaxDepth = 8;

// Empirical discount applied to the naive "ink area / circle area" estimate.
// Naive formula assumes 100% packing efficiency; reality (random placement,
// INT_Offset padding, boundary loss on thin strokes) is much lower. This is
// only the initial estimate — DotRenderer grows the letter size if drawDigit
// still can't fit all its dots.
export const PackingCoefficient = 0.45;

export const LetterGrowFactor = 1.25;
