import { describe, it, expect } from "vitest";
import { Quadtree } from "../src/renderer/quadtree";
import type { Dot } from "../src/renderer/types";

const dot = (cx: number, cy: number, r = 2): Dot => ({ cx, cy, r, color: "#000" });

describe("Quadtree", () => {
  it("returns empty array on empty tree", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 });
    expect(qt.queryCircle(50, 50, 10)).toEqual([]);
  });

  it("finds a single inserted dot when query overlaps it", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 });
    const d = dot(50, 50);
    qt.insert(d);
    const hits = qt.queryCircle(50, 50, 5);
    expect(hits).toContain(d);
  });

  it("does not return a dot far from the query", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 });
    qt.insert(dot(10, 10, 1));
    const hits = qt.queryCircle(90, 90, 2);
    expect(hits).toEqual([]);
  });

  it("subdivides after exceeding capacity and still returns correct results", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 }, 2, 6);
    const dots: Dot[] = [];
    for (let i = 0; i < 20; i++) {
      const d = dot(5 + i * 4, 5 + i * 4, 1);
      dots.push(d);
      qt.insert(d);
    }
    // Query a small region around the middle; expect only nearby dots.
    const hits = qt.queryCircle(50, 50, 5);
    for (const h of hits) {
      expect(h.cx).toBeGreaterThan(40);
      expect(h.cx).toBeLessThan(60);
    }
    // Query the full area; expect all dots present (no dupes in results is not required,
    // but every inserted dot must appear at least once).
    const all = qt.queryCircle(50, 50, 200);
    for (const d of dots) expect(all).toContain(d);
  });

  it("respects maxDepth without infinite recursion", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 }, 2, 3);
    // Insert 200 coincident dots to force subdivision to bottom out.
    for (let i = 0; i < 200; i++) qt.insert(dot(50, 50, 0.1));
    const hits = qt.queryCircle(50, 50, 1);
    expect(hits.length).toBeGreaterThanOrEqual(200);
  });

  it("finds a dot straddling the center of the root bounds", () => {
    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 }, 2, 6);
    // Force subdivision first
    for (let i = 0; i < 5; i++) qt.insert(dot(10 + i, 10 + i, 1));
    const straddle = dot(50, 50, 4);
    qt.insert(straddle);
    // Any of the four quadrant-center queries should find the straddling dot
    for (const [x, y] of [[25, 25], [75, 25], [25, 75], [75, 75]] as const) {
      const hits = qt.queryCircle(x, y, 30);
      expect(hits).toContain(straddle);
    }
  });
});
