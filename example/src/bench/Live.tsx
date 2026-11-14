// On-screen frame pacing while every region's colour animates, drawn two ways:
// one Skia node per region, or one picture re-recorded on the UI thread.
import { Blur, Canvas, Group, Paint, Path, Picture, Skia } from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Easing, useDerivedValue, useFrameCallback, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { glowOpacity, intensityMix } from 'momentum-muscle-map/core';
import type { BodyData } from 'momentum-muscle-map/core';
import { COLORS, GLOW_SIGMA, LEGS, PUSH, buildScene, drawScene, fit, summarise, valuesFor } from './scene';
import type { GlowMode, Scene } from './scene';

export type LiveVariant = 'nodes' | 'picture' | 'static';

interface Props {
  body: BodyData;
  variant: LiveVariant;
  glow: GlowMode;
  seconds: number;
  onDone: (result: unknown) => void;
}

interface RegionProps {
  path: SkPath;
  a: number;
  b: number;
  progress: SharedValue<number>;
  rest: Float32Array;
  accent: Float32Array;
}

function Region({ path, a, b, progress, rest, accent }: RegionProps) {
  const color = useDerivedValue(() => {
    const f = intensityMix(a + (b - a) * progress.value);
    return [rest[0]! + (accent[0]! - rest[0]!) * f, rest[1]! + (accent[1]! - rest[1]!) * f, rest[2]! + (accent[2]! - rest[2]!) * f, 1];
  });
  return <Path path={path} color={color} />;
}

function GlowRegion({ path, a, b, progress, maskBlur }: Pick<RegionProps, 'path' | 'a' | 'b' | 'progress'> & { maskBlur: boolean }) {
  const opacity = useDerivedValue(() => glowOpacity(a + (b - a) * progress.value));
  return (
    <Path path={path} color={COLORS.accent} opacity={opacity}>
      {maskBlur ? <Blur blur={GLOW_SIGMA} /> : null}
    </Path>
  );
}

function Nodes({ scene, a, b, progress, glow }: { scene: Scene; a: number[]; b: number[]; progress: SharedValue<number>; glow: GlowMode }) {
  // only regions that glow at some point get a glow node
  const glowing = scene.paths.map((_, i) => !scene.inert[i] && (a[i]! > 0.6 || b[i]! > 0.6));
  const glowNodes = scene.paths.map((path, i) =>
    glowing[i] ? <GlowRegion key={i} path={path} a={a[i]!} b={b[i]!} progress={progress} maskBlur={glow === 'mask'} /> : null,
  );
  return (
    <>
      <Path path={scene.outline} color={COLORS.body} />
      {glow === 'layer' ? (
        <Group
          layer={
            <Paint>
              <Blur blur={GLOW_SIGMA} />
            </Paint>
          }
        >
          {glowNodes}
        </Group>
      ) : glow === 'mask' ? (
        glowNodes
      ) : null}
      {scene.paths.map((path, i) =>
        scene.inert[i] ? (
          <Path key={i} path={path} color={COLORS.inert} />
        ) : (
          <Region key={i} path={path} a={a[i]!} b={b[i]!} progress={progress} rest={scene.rest} accent={scene.accent} />
        ),
      )}
    </>
  );
}

interface Size {
  width: number;
  height: number;
}

function PictureBody({ scene, a, b, progress, glow, size, body, recordMs }: {
  scene: Scene;
  a: number[];
  b: number[];
  progress: SharedValue<number>;
  glow: GlowMode;
  size: Size;
  body: BodyData;
  recordMs: SharedValue<number[]>;
}) {
  const { scale, tx, ty } = fit(body, size.width, size.height, 12);
  const bounds = useMemo(() => Skia.XYWHRect(0, 0, size.width, size.height), [size]);
  const picture = useDerivedValue(() => {
    const t0 = performance.now();
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(bounds);
    canvas.translate(tx, ty);
    canvas.scale(scale, scale);
    drawScene(canvas, scene, a, b, progress.value, glow);
    const result = recorder.finishRecordingAsPicture();
    const took = performance.now() - t0;
    // Storing the timing makes this value depend on itself, so the picture is
    // re-recorded every frame even in the 'static' case. That is what the
    // benchmark wants (a recording cost per frame), not what a renderer should do.
    recordMs.modify((list) => {
      'worklet';
      list.push(took);
      return list;
    });
    return result;
  });
  return <Picture picture={picture} />;
}

function Running({ body, variant, glow, seconds, onDone, size }: Props & { size: Size }) {
  const scene = useMemo(() => buildScene(body, 'parts'), [body]);
  const a = useMemo(() => valuesFor(body, 'parts', PUSH), [body]);
  const b = useMemo(() => valuesFor(body, 'parts', LEGS), [body]);
  const progress = useSharedValue(0);
  const frames = useSharedValue<number[]>([]);
  const recordMs = useSharedValue<number[]>([]);
  const { scale, tx, ty } = fit(body, size.width, size.height, 12);

  useEffect(() => {
    if (variant !== 'static') progress.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    const started = performance.now();
    const timer = setTimeout(() => {
      const elapsed = (performance.now() - started) / 1000;
      // the first second is left out so mounting does not count as animation
      const all = frames.value;
      const steady = all.slice(Math.min(all.length, 60));
      const stats = summarise(steady);
      const slow = steady.filter((dt) => dt > stats.median * 1.5).length;
      onDone({
        variant,
        glow,
        canvas: size,
        fps: Math.round((all.length / elapsed) * 10) / 10,
        frameMs: stats,
        slowFramesPercent: Math.round((slow / Math.max(1, steady.length)) * 1000) / 10,
        recordMs: recordMs.value.length > 30 ? summarise(recordMs.value.slice(30)) : undefined,
      });
    }, seconds * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrameCallback((info) => {
    const dt = info.timeSincePreviousFrame;
    if (dt != null) {
      frames.modify((list) => {
        'worklet';
        list.push(dt);
        return list;
      });
    }
  });

  return (
    <Canvas style={{ flex: 1 }}>
      {variant === 'nodes' ? (
        <Group transform={[{ translateX: tx }, { translateY: ty }, { scale }]}>
          <Nodes scene={scene} a={a} b={b} progress={progress} glow={glow} />
        </Group>
      ) : (
        <PictureBody scene={scene} a={a} b={b} progress={progress} glow={glow} size={size} body={body} recordMs={recordMs} />
      )}
    </Canvas>
  );
}

export function Live(props: Props) {
  const [size, setSize] = useState<Size | null>(null);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {size ? <Running {...props} size={size} /> : null}
    </View>
  );
}
