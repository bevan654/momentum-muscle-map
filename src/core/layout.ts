import type { BodyData } from './types';

/** How a body is placed in a box: multiply body coordinates by `scale`, then add the offsets. */
export interface BodyLayout {
  scale: number;
  tx: number;
  ty: number;
}

/** Fits a body's silhouette into a box, centred, keeping its proportions. */
export function fitBody(body: BodyData, width: number, height: number, padding = 0): BodyLayout {
  const [x0, y0, x1, y1] = body.bounds;
  const w = Math.max(0, width - 2 * padding);
  const h = Math.max(0, height - 2 * padding);
  const scale = Math.min(w / (x1 - x0), h / (y1 - y0));
  return {
    scale,
    tx: (width - (x1 - x0) * scale) / 2 - x0 * scale,
    ty: (height - (y1 - y0) * scale) / 2 - y0 * scale,
  };
}
