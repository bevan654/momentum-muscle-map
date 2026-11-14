// Benchmarks that run to completion on the JS thread: data and path set-up
// costs, and the cost of drawing one frame each way into an offscreen surface.
import { Skia } from '@shopify/react-native-skia';
import type { SkSurface } from '@shopify/react-native-skia';
import { candidatesAt, getBodyModel, resolveValues, unitPath } from 'momentum-muscle-map/core';
import type { BodyData } from 'momentum-muscle-map/core';
import { COLORS, EVERYTHING, LEGS, PUSH, buildPaths, buildScene, drawScene, fit, summarise, valuesFor } from './scene';
import type { GlowMode } from './scene';

const now = () => performance.now();

function repeat(runs: number, fn: () => void) {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = now();
    fn();
    samples.push(now() - t);
  }
  return summarise(samples);
}

export function setupCosts(body: BodyData) {
  const model = getBodyModel(body);
  const parts = buildPaths(body, 'parts');
  const points = Array.from({ length: 500 }, (_, i) => [250 + ((i * 37) % 520), 100 + ((i * 91) % 1300)] as const);
  return {
    // milliseconds per call
    parsePool: repeat(30, () => body.paths.forEach((d) => Skia.Path.MakeFromSVGString(d))),
    buildParts: repeat(30, () => buildPaths(body, 'parts')),
    buildMuscles: repeat(30, () => buildPaths(body, 'muscles')),
    buildGroups: repeat(30, () => buildPaths(body, 'groups')),
    buildOutline: repeat(30, () => Skia.Path.MakeFromSVGString(body.outline)),
    joinPartStrings: repeat(30, () => body.parts.forEach((u) => unitPath(body, u))),
    resolveParts: repeat(200, () => resolveValues(model, 'parts', PUSH)),
    resolveGroups: repeat(200, () => resolveValues(model, 'groups', PUSH)),
    hitTest500Taps: repeat(20, () => {
      for (const [x, y] of points) {
        for (const i of candidatesAt(body, 'parts', x, y)) if (parts[i]!.contains(x, y)) break;
      }
    }),
  };
}

/**
 * Reads the surface back, which makes the GPU finish what it was given. The
 * snapshot is released straight away on this thread: left to the garbage
 * collector it is freed from another thread, which intermittently trips an
 * assertion in Skia's GPU resource cache.
 */
function finishGpu(surface: SkSurface) {
  const snapshot = surface.makeImageSnapshot();
  snapshot.readPixels();
  snapshot.dispose();
}

/** Milliseconds to draw one frame into an offscreen surface of the given pixel size. */
function drawCost(body: BodyData, surface: SkSurface, frames: number, variant: string, glow: GlowMode, worstCase: boolean) {
  const width = surface.width();
  const height = surface.height();
  const canvas = surface.getCanvas();
  const scene = buildScene(body, 'parts');
  const a = valuesFor(body, 'parts', worstCase ? EVERYTHING : PUSH);
  const b = valuesFor(body, 'parts', worstCase ? EVERYTHING : LEGS);
  const { scale, tx, ty } = fit(body, width, height);
  const background = Skia.Color(COLORS.background);
  const bounds = Skia.XYWHRect(0, 0, width, height);
  const record = (t: number) => {
    const recorder = Skia.PictureRecorder();
    const c = recorder.beginRecording(bounds);
    c.translate(tx, ty);
    c.scale(scale, scale);
    drawScene(c, scene, a, b, t, glow);
    return recorder.finishRecordingAsPicture();
  };
  // One recorded picture per animation step, so 'replay' draws the same frames
  // as the other variants. A single picture from the middle of the blend would
  // have no glow in it: no value is above the glow threshold there.
  const cached = Array.from({ length: 60 }, (_, i) => record(i / 59));
  const frame = (i: number) => {
    const t = (i % 60) / 59;
    canvas.clear(background);
    if (variant === 'direct') {
      canvas.save();
      canvas.translate(tx, ty);
      canvas.scale(scale, scale);
      drawScene(canvas, scene, a, b, t, glow);
      canvas.restore();
    } else if (variant === 'replay') {
      canvas.drawPicture(cached[i % 60]!);
    } else {
      canvas.drawPicture(record(t));
    }
    surface.flush();
  };
  // The very first frame, timed on its own: it pays any first-use cost, such as
  // blurring a region's mask for the first time. Each case builds new paths, so
  // nothing drawn by an earlier case is cached for it.
  const tf = now();
  frame(0);
  finishGpu(surface);
  const firstFrame = now() - tf;
  // Then warm up over one whole blend, so every region that glows at any step
  // has been drawn once and no first-use cost lands inside the steady timing.
  for (let i = 0; i < 60; i++) frame(i);
  finishGpu(surface);
  const t0 = now();
  for (let i = 0; i < frames; i++) frame(i);
  // the GPU's work is inside the timing
  finishGpu(surface);
  const total = now() - t0;
  // recording on its own, without drawing
  const tr = now();
  for (let i = 0; i < frames; i++) record((i % 60) / 59);
  const recordOnly = (now() - tr) / frames;
  return {
    msPerFrame: Math.round((total / frames) * 1000) / 1000,
    firstFrameMs: Math.round(firstFrame * 100) / 100,
    recordOnlyMs: Math.round(recordOnly * 1000) / 1000,
  };
}

const keptSurfaces = new Map<string, SkSurface>();

export function drawCosts(body: BodyData) {
  const out: Record<string, unknown> = {};
  // a body shown 700pt tall on a 3x screen, and a 120pt feed-card map
  const sizes = { full: [966, 2100], mini: [165, 360] } as const;
  for (const [sizeName, [w, h]] of Object.entries(sizes)) {
    // One surface per size, shared by every case and kept for the life of the
    // app. Freeing offscreen surfaces between cases, by hand or by the garbage
    // collector, intermittently trips an assertion in Skia's GPU resource cache.
    const surface = keptSurfaces.get(sizeName) ?? Skia.Surface.MakeOffscreen(w, h);
    if (!surface) {
      out[sizeName] = { error: 'no offscreen surface' };
      continue;
    }
    keptSurfaces.set(sizeName, surface);
    for (const glow of ['none', 'mask', 'layer'] as const) {
      for (const variant of ['direct', 'replay', 'rerecord']) {
        out[`${sizeName}/${glow}/${variant}`] = drawCost(body, surface, 120, variant, glow, false);
      }
    }
    for (const glow of ['mask', 'layer'] as const) {
      out[`${sizeName}/${glow}/direct/everythingLit`] = drawCost(body, surface, 120, 'direct', glow, true);
    }
  }
  return out;
}
