// Benchmarks that run to completion on the JS thread: data and path set-up
// costs, and the cost of drawing one frame each way into an offscreen surface.
import { Skia } from '@shopify/react-native-skia';
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

/** Milliseconds to draw one frame into an offscreen surface of the given pixel size. */
function drawCost(body: BodyData, width: number, height: number, frames: number, variant: string, glow: GlowMode, worstCase: boolean) {
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) return { error: 'no offscreen surface' };
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
  for (let i = 0; i < 10; i++) frame(i);
  surface.makeImageSnapshot().readPixels();
  const t0 = now();
  for (let i = 0; i < frames; i++) frame(i);
  // reading pixels back makes the GPU finish, so its work is inside the timing
  surface.makeImageSnapshot().readPixels();
  const total = now() - t0;
  // recording on its own, without drawing
  const tr = now();
  for (let i = 0; i < frames; i++) record((i % 60) / 59);
  const recordOnly = (now() - tr) / frames;
  for (const picture of cached) picture.dispose();
  surface.dispose();
  return { msPerFrame: Math.round((total / frames) * 1000) / 1000, recordOnlyMs: Math.round(recordOnly * 1000) / 1000 };
}

export function drawCosts(body: BodyData) {
  const out: Record<string, unknown> = {};
  // a body shown 700pt tall on a 3x screen, and a 120pt feed-card map
  const sizes = { full: [966, 2100], mini: [165, 360] } as const;
  for (const [sizeName, [w, h]] of Object.entries(sizes)) {
    for (const glow of ['none', 'mask', 'layer'] as const) {
      for (const variant of ['direct', 'replay', 'rerecord']) {
        out[`${sizeName}/${glow}/${variant}`] = drawCost(body, w, h, 120, variant, glow, false);
      }
    }
    for (const glow of ['mask', 'layer'] as const) {
      out[`${sizeName}/${glow}/direct/everythingLit`] = drawCost(body, w, h, 120, 'direct', glow, true);
    }
  }
  return out;
}
