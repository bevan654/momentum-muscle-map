import { Skia, TileMode } from '@shopify/react-native-skia';
import type { SkCanvas, SkPaint, SkPath } from '@shopify/react-native-skia';
import { glowOpacity, intensityMix } from '../core';
import type { LevelPaths } from './scene';

/** Glow blur radius in body units. */
const GLOW_SIGMA = 11;

export interface MuscleMapColors {
  /** A muscle at intensity 0. */
  rest: string;
  /** A muscle at intensity 1, and the glow. */
  accent: string;
  /** Tendons, fascia and the kneecap. */
  inert: string;
  /** The silhouette behind the muscles. */
  body: string;
}

/** Everything the drawing worklet needs besides the values. */
export interface Brush {
  outline: SkPath;
  rest: Float32Array;
  accent: Float32Array;
  bodyPaint: SkPaint;
  inertPaint: SkPaint;
  fillPaint: SkPaint;
  glowPaint: SkPaint;
  glowLayerPaint: SkPaint;
}

function fill(color: string): SkPaint {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  return paint;
}

export function createBrush(outline: SkPath, colors: MuscleMapColors): Brush {
  const glowLayerPaint = Skia.Paint();
  glowLayerPaint.setImageFilter(Skia.ImageFilter.MakeBlur(GLOW_SIGMA, GLOW_SIGMA, TileMode.Decal, null));
  return {
    outline,
    rest: Skia.Color(colors.rest),
    accent: Skia.Color(colors.accent),
    bodyPaint: fill(colors.body),
    inertPaint: fill(colors.inert),
    fillPaint: fill(colors.rest),
    glowPaint: fill(colors.accent),
    glowLayerPaint,
  };
}

const sharedBrushes = new WeakMap<SkPath, Map<string, Brush>>();

/**
 * A brush shared by every static map with the same body and colours. Only for
 * maps drawn on the JS thread: an animated map draws on the UI thread and
 * changes its brush's paints there, so it needs a brush of its own.
 */
export function getSharedBrush(outline: SkPath, colors: MuscleMapColors): Brush {
  let byColors = sharedBrushes.get(outline);
  if (!byColors) {
    byColors = new Map();
    sharedBrushes.set(outline, byColors);
  }
  const key = `${colors.rest}|${colors.accent}|${colors.inert}|${colors.body}`;
  let brush = byColors.get(key);
  if (!brush) {
    brush = createBrush(outline, colors);
    byColors.set(key, brush);
  }
  return brush;
}

/**
 * Draws the silhouette and one level of regions in body coordinates.
 *
 * Each region's intensity is `from[i]` blended towards `to[i]` by `t`. If the
 * value lists do not match the level (for example for one frame while the
 * level is changing) the regions are drawn at rest.
 */
export function drawBody(canvas: SkCanvas, brush: Brush, level: LevelPaths, from: number[], to: number[], t: number, glow: boolean) {
  'worklet';
  const { paths, inert } = level;
  const n = paths.length;
  const usable = to.length === n;
  const blend = usable && from.length === n && t < 1;
  canvas.drawPath(brush.outline, brush.bodyPaint);

  if (glow && usable) {
    // All glowing regions share one blurred layer, opened only if something glows.
    let open = false;
    for (let i = 0; i < n; i++) {
      if (inert[i]) continue;
      const opacity = glowOpacity(blend ? from[i]! + (to[i]! - from[i]!) * t : to[i]!);
      if (opacity <= 0) continue;
      if (!open) {
        canvas.saveLayer(brush.glowLayerPaint);
        open = true;
      }
      brush.glowPaint.setAlphaf(opacity);
      canvas.drawPath(paths[i]!, brush.glowPaint);
    }
    if (open) canvas.restore();
  }

  const { rest, accent, fillPaint } = brush;
  const color = new Float32Array(4);
  color[3] = 1;
  for (let i = 0; i < n; i++) {
    if (inert[i]) {
      canvas.drawPath(paths[i]!, brush.inertPaint);
      continue;
    }
    const f = usable ? intensityMix(blend ? from[i]! + (to[i]! - from[i]!) * t : to[i]!) : 0;
    color[0] = rest[0]! + (accent[0]! - rest[0]!) * f;
    color[1] = rest[1]! + (accent[1]! - rest[1]!) * f;
    color[2] = rest[2]! + (accent[2]! - rest[2]!) * f;
    fillPaint.setColor(color);
    canvas.drawPath(paths[i]!, fillPaint);
  }
}
