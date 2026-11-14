import { Skia, TileMode } from '@shopify/react-native-skia';
import type { SkCanvas, SkPaint, SkPath } from '@shopify/react-native-skia';
import type { Palette } from '../core';
import type { LevelPaths } from './scene';

/** Glow blur radius in body units. */
const GLOW_SIGMA = 11;

export interface MuscleMapColors {
  /** A muscle at intensity 0. */
  rest: string;
  /** A muscle at intensity 1, and the glow. Not used when `scale` is set. */
  accent: string;
  /**
   * Two or more colours spread evenly over 0 to 1, for example green, orange,
   * red. When set, a muscle with a value takes its colour from here (0 is the
   * first colour), a muscle with no value stays `rest`, and the glow takes the
   * muscle's own colour. Transparency in these colours is ignored.
   */
  scale?: readonly string[];
  /** Tendons, fascia and the kneecap. */
  inert: string;
  /** The silhouette behind the muscles. */
  body: string;
}

/** Everything the drawing worklet needs besides the values. */
export interface Brush extends Palette {
  outline: SkPath;
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
  const stops = colors.scale && colors.scale.length > 1 ? colors.scale : null;
  let scale: Float32Array | null = null;
  if (stops) {
    scale = new Float32Array(stops.length * 3);
    stops.forEach((stop, i) => scale!.set(Skia.Color(stop).subarray(0, 3), i * 3));
  }
  return {
    outline,
    rest: Skia.Color(colors.rest),
    accent: Skia.Color(colors.accent),
    scale,
    bodyPaint: fill(colors.body),
    inertPaint: fill(colors.inert),
    fillPaint: fill(colors.rest),
    glowPaint: fill(colors.accent),
    glowLayerPaint,
  };
}

/** A scale as one string, so it can be compared by its colours and not by the array it came in. */
export function scaleKey(scale: readonly string[] | undefined): string {
  return scale ? scale.join('|') : '';
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
  const key = `${colors.rest}|${colors.accent}|${colors.inert}|${colors.body}|${scaleKey(colors.scale)}`;
  let brush = byColors.get(key);
  if (!brush) {
    brush = createBrush(outline, colors);
    byColors.set(key, brush);
  }
  return brush;
}

/**
 * Draws the silhouette and one level of regions in body coordinates. `looks`
 * is the colour and glow of each region, from `regionLooks`.
 */
export function drawBody(canvas: SkCanvas, brush: Brush, level: LevelPaths, looks: number[], glow: boolean) {
  'worklet';
  const { paths, inert } = level;
  const n = paths.length;
  const { fillPaint, glowPaint } = brush;
  const color = new Float32Array(4);
  canvas.drawPath(brush.outline, brush.bodyPaint);

  if (glow) {
    // All glowing regions share one blurred layer, opened only if something glows.
    // Without a scale the glow is the accent colour; with one it is the region's own.
    const own = brush.scale !== null;
    let open = false;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const opacity = looks[o + 3]!;
      if (inert[i] || !(opacity > 0)) continue;
      if (!open) {
        canvas.saveLayer(brush.glowLayerPaint);
        open = true;
      }
      if (own) {
        color[0] = looks[o]!;
        color[1] = looks[o + 1]!;
        color[2] = looks[o + 2]!;
        color[3] = opacity;
        glowPaint.setColor(color);
      } else {
        glowPaint.setAlphaf(opacity);
      }
      canvas.drawPath(paths[i]!, glowPaint);
    }
    if (open) canvas.restore();
  }

  color[3] = 1;
  for (let i = 0; i < n; i++) {
    if (inert[i]) {
      canvas.drawPath(paths[i]!, brush.inertPaint);
      continue;
    }
    const o = i * 4;
    color[0] = looks[o]!;
    color[1] = looks[o + 1]!;
    color[2] = looks[o + 2]!;
    fillPaint.setColor(color);
    canvas.drawPath(paths[i]!, fillPaint);
  }
}
