import type { Rect, Dot } from "./types";
import { QuadtreeCapacity, QuadtreeMaxDepth } from "./constants";

/**
 * A quadtree of placed dots. Each node holds up to `capacity` items before
 * subdividing into 4 children (NW, NE, SW, SE). Bounds are AABBs.
 *
 * queryCircle returns dots whose bounding box intersects the query circle's
 * bounding box; callers still do the exact distance test.
 */
export class Quadtree {
  readonly bounds: Rect;
  readonly capacity: number;
  readonly maxDepth: number;
  private readonly depth: number;
  private items: Dot[] = [];
  private children: Quadtree[] | null = null;

  constructor(
    bounds: Rect,
    capacity: number = QuadtreeCapacity,
    maxDepth: number = QuadtreeMaxDepth,
    depth: number = 0,
  ) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
  }

  insert(dot: Dot): boolean {
    if (!this.dotBBoxIntersects(dot, this.bounds)) return false;

    if (this.children === null) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(dot);
        return true;
      }
      this.subdivide();
    }

    // Insert into every child whose bounds the dot's AABB overlaps.
    // A dot may straddle child boundaries; storing in all overlapped children
    // keeps queries correct at the cost of some duplication.
    let inserted = false;
    for (const c of this.children!) {
      if (c.insert(dot)) inserted = true;
    }
    if (!inserted) {
      // Fallback: shouldn't happen since dot intersects our bounds, but keep it safe.
      this.items.push(dot);
    }
    return true;
  }

  queryCircle(cx: number, cy: number, r: number, out: Dot[] = []): Dot[] {
    if (!this.circleBBoxIntersects(cx, cy, r, this.bounds)) return out;
    for (const d of this.items) {
      if (this.dotBBoxIntersectsCircleBBox(d, cx, cy, r)) out.push(d);
    }
    if (this.children !== null) {
      for (const c of this.children) c.queryCircle(cx, cy, r, out);
    }
    return out;
  }

  private subdivide(): void {
    const { x, y, width, height } = this.bounds;
    const hw = width / 2;
    const hh = height / 2;
    const d = this.depth + 1;
    this.children = [
      new Quadtree({ x, y, width: hw, height: hh }, this.capacity, this.maxDepth, d),
      new Quadtree({ x: x + hw, y, width: width - hw, height: hh }, this.capacity, this.maxDepth, d),
      new Quadtree({ x, y: y + hh, width: hw, height: height - hh }, this.capacity, this.maxDepth, d),
      new Quadtree({ x: x + hw, y: y + hh, width: width - hw, height: height - hh }, this.capacity, this.maxDepth, d),
    ];
    const carry = this.items;
    this.items = [];
    for (const d of carry) {
      let inserted = false;
      for (const c of this.children) if (c.insert(d)) inserted = true;
      if (!inserted) this.items.push(d);
    }
  }

  private dotBBoxIntersects(d: Dot, b: Rect): boolean {
    return (
      d.cx + d.r >= b.x &&
      d.cx - d.r <= b.x + b.width &&
      d.cy + d.r >= b.y &&
      d.cy - d.r <= b.y + b.height
    );
  }

  private circleBBoxIntersects(cx: number, cy: number, r: number, b: Rect): boolean {
    return (
      cx + r >= b.x &&
      cx - r <= b.x + b.width &&
      cy + r >= b.y &&
      cy - r <= b.y + b.height
    );
  }

  private dotBBoxIntersectsCircleBBox(d: Dot, cx: number, cy: number, r: number): boolean {
    return (
      d.cx + d.r >= cx - r &&
      d.cx - d.r <= cx + r &&
      d.cy + d.r >= cy - r &&
      d.cy - d.r <= cy + r
    );
  }
}
