// Many feed-card maps in a scrolling list, drawn two ways: a live Skia canvas
// per card, or a PNG rendered once and shown with a plain React Native image.
import { Canvas, ImageFormat, Picture, Skia } from '@shopify/react-native-skia';
import type { SkPicture, SkSurface } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { Image, PixelRatio, ScrollView, View } from 'react-native';
import type { BodyData } from 'momentum-muscle-map/core';
import { LEGS, PUSH, buildScene, drawScene, fit, valuesFor } from './scene';

export type MiniVariant = 'canvas' | 'image' | 'none';

const HEIGHT = 120;
const WIDTH = 56;

let pngSurface: SkSurface | null = null;

interface Props {
  body: BodyData;
  variant: MiniVariant;
  count: number;
  onDone: (result: unknown) => void;
}

export function MiniList({ body, variant, count, onDone }: Props) {
  const started = useMemo(() => performance.now(), []);
  const { pictures, uris, prepareMs } = useMemo(() => {
    const t0 = performance.now();
    const scene = buildScene(body, 'groups');
    const zero = valuesFor(body, 'groups', {});
    const { scale, tx, ty } = fit(body, WIDTH, HEIGHT);
    const pictures: SkPicture[] = [];
    const uris: string[] = [];
    // One small surface renders every PNG. It is kept for the life of the app,
    // because freeing an offscreen surface can crash inside Skia's GPU resource
    // cache (see timed.ts), so the image case's memory includes it.
    const ratio = PixelRatio.get();
    if (variant === 'image' && !pngSurface) {
      pngSurface = Skia.Surface.MakeOffscreen(Math.round(WIDTH * ratio), Math.round(HEIGHT * ratio));
      pngSurface?.getCanvas().scale(ratio, ratio);
    }
    const surface = variant === 'image' ? pngSurface : null;
    for (let i = 0; i < (variant === 'none' ? 0 : count); i++) {
      // a different picture per card, as a feed would have
      const values = valuesFor(body, 'groups', i % 2 ? PUSH : LEGS).map((v) => v * (0.5 + (0.5 * i) / count));
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, WIDTH, HEIGHT));
      canvas.translate(tx, ty);
      canvas.scale(scale, scale);
      drawScene(canvas, scene, zero, values, 1, 'none');
      const picture = recorder.finishRecordingAsPicture();
      if (surface) {
        const c = surface.getCanvas();
        c.clear(Skia.Color('transparent'));
        c.drawPicture(picture);
        surface.flush();
        const snapshot = surface.makeImageSnapshot();
        uris.push(`data:image/png;base64,${snapshot.encodeToBase64(ImageFormat.PNG, 100)}`);
        snapshot.dispose();
        picture.dispose();
      } else {
        pictures.push(picture);
      }
    }
    return { pictures, uris, prepareMs: performance.now() - t0 };
  }, [body, variant, count]);

  useEffect(() => {
    // two frames later everything has been laid out and drawn once
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        onDone({
          variant,
          count,
          prepareMs: Math.round(prepareMs * 100) / 100,
          mountToSecondFrameMs: Math.round((performance.now() - started) * 100) / 100,
          pngBytesEach: uris[0] ? Math.round((uris[0].length * 3) / 4) : undefined,
        });
      }),
    );
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 }}>
      {pictures.map((picture, i) => (
        <View key={i} style={{ width: WIDTH, height: HEIGHT }}>
          <Canvas style={{ width: WIDTH, height: HEIGHT }}>
            <Picture picture={picture} />
          </Canvas>
        </View>
      ))}
      {uris.map((uri, i) => (
        <View key={i} style={{ width: WIDTH, height: HEIGHT }}>
          <Image source={{ uri }} style={{ width: WIDTH, height: HEIGHT }} />
        </View>
      ))}
    </ScrollView>
  );
}
