import { candidatesAt } from '../core';
import type { BodyData, BodyLayout, Level } from '../core';
import type { LevelPaths } from './scene';

/** How far from a region a tap may land and still count, in screen points. */
const SLOP = 10;
const RING = [
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
  [0, -1],
  [0.7, -0.7],
] as const;

function unitAt(body: BodyData, level: Level, paths: LevelPaths, x: number, y: number): number {
  for (const i of candidatesAt(body, level, x, y)) {
    if (paths.paths[i]!.contains(x, y)) return i;
  }
  return -1;
}

/**
 * Index of the unit under a point given in view coordinates, or -1.
 * A tap that just misses still finds the nearest region within a small radius,
 * because some regions are only a few points wide.
 */
export function hitTest(body: BodyData, level: Level, paths: LevelPaths, layout: BodyLayout, viewX: number, viewY: number): number {
  if (!(layout.scale > 0)) return -1;
  const x = (viewX - layout.tx) / layout.scale;
  const y = (viewY - layout.ty) / layout.scale;
  const exact = unitAt(body, level, paths, x, y);
  if (exact >= 0) return exact;
  for (const radius of [SLOP / 2, SLOP]) {
    const r = radius / layout.scale;
    for (const [dx, dy] of RING) {
      const near = unitAt(body, level, paths, x + dx * r, y + dy * r);
      if (near >= 0) return near;
    }
  }
  return -1;
}
