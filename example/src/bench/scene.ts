import { BlurStyle, Skia, TileMode } from '@shopify/react-native-skia';
import type { SkCanvas, SkPaint, SkPath } from '@shopify/react-native-skia';
import { describeUnit, getBodyModel, glowOpacity, intensityMix, resolveValues, unitPath } from 'momentum-muscle-map/core';
import type { BodyData, Level, MuscleValues } from 'momentum-muscle-map/core';

export const COLORS = { background: '#0D0D0F', body: '#1C1C20', rest: '#2F2F35', accent: '#FF6B35', inert: '#27272C' };
/** Glow blur radius in body units, the same as the HTML prototype. */
export const GLOW_SIGMA = 11;

export const PUSH: MuscleValues = { chest: 1, deltoid_anterior: 0.85, shoulders: 0.5, triceps_brachii: 0.8, core: 0.3 };
export const LEGS: MuscleValues = { quads: 1, glutes: 0.8, adductors: 0.5, calves: 0.6, core: 0.4 };
export const EVERYTHING: MuscleValues = {
  neck: 1, traps: 1, shoulders: 1, chest: 1, back: 1, core: 1, arms: 1, forearms: 1, glutes: 1, quads: 1, adductors: 1, hamstrings: 1, calves: 1,
};

export type GlowMode = 'none' | 'mask' | 'layer';

export interface Scene {
  body: BodyData;
  outline: SkPath;
  paths: SkPath[];
  inert: boolean[];
  rest: Float32Array;
  accent: Float32Array;
  bodyPaint: SkPaint;
  inertPaint: SkPaint;
  fillPaint: SkPaint;
  /** Glow drawn as one blurred mask per region. */
  maskGlowPaint: SkPaint;
  /** Glow drawn as plain shapes inside one blurred layer. */
  layerPaint: SkPaint;
  layerGlowPaint: SkPaint;
}

const fill = (color: string) => {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  return paint;
};

export function buildPaths(body: BodyData, level: Level): SkPath[] {
  return body[level].map((u) => Skia.Path.MakeFromSVGString(unitPath(body, u))!);
}

export function buildScene(body: BodyData, level: Level): Scene {
  const model = getBodyModel(body);
  const maskGlowPaint = fill(COLORS.accent);
  maskGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, GLOW_SIGMA, true));
  const layerPaint = Skia.Paint();
  layerPaint.setImageFilter(Skia.ImageFilter.MakeBlur(GLOW_SIGMA, GLOW_SIGMA, TileMode.Decal, null));
  return {
    body,
    outline: Skia.Path.MakeFromSVGString(body.outline)!,
    paths: buildPaths(body, level),
    inert: body[level].map((_, i) => !describeUnit(model, level, i)!.isMuscle),
    rest: Skia.Color(COLORS.rest),
    accent: Skia.Color(COLORS.accent),
    bodyPaint: fill(COLORS.body),
    inertPaint: fill(COLORS.inert),
    fillPaint: fill(COLORS.rest),
    maskGlowPaint,
    layerPaint,
    layerGlowPaint: fill(COLORS.accent),
  };
}

export function valuesFor(body: BodyData, level: Level, values: MuscleValues): number[] {
  return resolveValues(getBodyModel(body), level, values);
}

/** Scale and offset that fit the body into a box, centred. */
export function fit(body: BodyData, width: number, height: number, padding = 0) {
  const [x0, y0, x1, y1] = body.bounds;
  const scale = Math.min((width - 2 * padding) / (x1 - x0), (height - 2 * padding) / (y1 - y0));
  return { scale, tx: (width - (x1 - x0) * scale) / 2 - x0 * scale, ty: (height - (y1 - y0) * scale) / 2 - y0 * scale };
}

/** Draws the whole body. `a` and `b` are value sets and `t` blends between them. */
export function drawScene(canvas: SkCanvas, scene: Scene, a: number[], b: number[], t: number, glow: GlowMode) {
  'worklet';
  const { paths, inert, rest, accent } = scene;
  canvas.drawPath(scene.outline, scene.bodyPaint);
  if (glow !== 'none') {
    const paint = glow === 'mask' ? scene.maskGlowPaint : scene.layerGlowPaint;
    let layerOpen = false;
    for (let i = 0; i < paths.length; i++) {
      const opacity = inert[i] ? 0 : glowOpacity(a[i]! + (b[i]! - a[i]!) * t);
      if (opacity <= 0) continue;
      if (glow === 'layer' && !layerOpen) {
        canvas.saveLayer(scene.layerPaint);
        layerOpen = true;
      }
      paint.setAlphaf(opacity);
      canvas.drawPath(paths[i]!, paint);
    }
    if (layerOpen) canvas.restore();
  }
  const color = new Float32Array(4);
  color[3] = 1;
  for (let i = 0; i < paths.length; i++) {
    if (inert[i]) {
      canvas.drawPath(paths[i]!, scene.inertPaint);
      continue;
    }
    const f = intensityMix(a[i]! + (b[i]! - a[i]!) * t);
    color[0] = rest[0]! + (accent[0]! - rest[0]!) * f;
    color[1] = rest[1]! + (accent[1]! - rest[1]!) * f;
    color[2] = rest[2]! + (accent[2]! - rest[2]!) * f;
    scene.fillPaint.setColor(color);
    canvas.drawPath(paths[i]!, scene.fillPaint);
  }
}

/** Middle, 95th percentile and worst of a list of timings. */
export function summarise(samples: number[]) {
  const s = [...samples].sort((x, y) => x - y);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1] ?? 0) };
}
