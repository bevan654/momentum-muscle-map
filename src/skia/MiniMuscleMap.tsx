import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { fitBody, getBodyModel, regionLooks, resolveValues } from '../core';
import type { BodyData, MuscleValues } from '../core';
import { drawBody, getSharedBrush, scaleKey } from './draw';
import type { MuscleMapColors } from './draw';
import { ensureLevel, getBodyScene } from './scene';

export interface MiniMuscleMapProps {
  body: BodyData;
  values: MuscleValues;
  colors: MuscleMapColors;
  /** Size in points. Fixed, so a list can lay the map out without measuring it. */
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * A small, static map at group level for cards in a list. It has no glow,
 * animation or touch handling: it is drawn once and only redrawn when its
 * props change.
 */
export const MiniMuscleMap = memo(function MiniMuscleMap({ body, values, colors, width, height, style, accessibilityLabel }: MiniMuscleMapProps) {
  const { rest, accent, inert, body: bodyColor } = colors;
  const stops = scaleKey(colors.scale);
  const picture = useMemo(() => {
    const scene = getBodyScene(body);
    const paths = ensureLevel(body, scene, 'groups');
    const brush = getSharedBrush(scene.outline, { rest, accent, inert, body: bodyColor, scale: stops ? stops.split('|') : undefined });
    const resolved = resolveValues(getBodyModel(body), 'groups', values, undefined, -1);
    const { scale, tx, ty } = fitBody(body, width, height);
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (scale > 0) {
      canvas.translate(tx, ty);
      canvas.scale(scale, scale);
      drawBody(canvas, brush, paths, regionLooks(brush, paths.inert, [], resolved, 1), false);
    }
    return recorder.finishRecordingAsPicture();
  }, [body, values, rest, accent, inert, bodyColor, stops, width, height]);

  // No touches on iOS, so a pressable card around the map still gets its taps.
  // Skia's Android view ignores this prop.
  return (
    <Canvas style={[{ width, height }, style]} pointerEvents="none" accessible={accessibilityLabel != null} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Picture picture={picture} />
    </Canvas>
  );
});
