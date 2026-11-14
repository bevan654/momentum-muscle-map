import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Easing, useAnimatedReaction, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { describeUnit, fitBody, getBodyModel, regionLooks, resolveValues } from '../core';
import type { BodyData, Level, MuscleValues, RegionInfo } from '../core';
import { createBrush, drawBody, scaleKey } from './draw';
import type { MuscleMapColors } from './draw';
import { hitTest } from './hitTest';
import { LEVELS, ensureLevel, getBodyScene } from './scene';

/** A pressed region: what it is, and the intensity it is showing. */
export interface PressedRegion extends RegionInfo {
  value: number;
}

export interface MuscleMapProps {
  /** One body view, imported from `momentum-muscle-map/data/...`. */
  body: BodyData;
  /** Intensities from 0 to 1, keyed by group, muscle or part, with or without a side. */
  values: MuscleValues;
  /** How finely to divide the body. Defaults to `muscles`. */
  level?: Level;
  colors: MuscleMapColors;
  /** Draw a soft glow around regions above 0.6. Defaults to true. */
  glow?: boolean;
  /** Milliseconds a change of values takes to fade in. 0 switches at once. Defaults to 300. */
  animationDuration?: number;
  /** Space kept clear around the body, in points. Defaults to 0. Use this, not padding or borders in `style`. */
  padding?: number;
  /** Called with the region under a tap. Without it the map ignores touches. */
  onRegionPress?: (region: PressedRegion) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

interface Size {
  width: number;
  height: number;
}

interface Shown {
  /** Index into `LEVELS`. */
  level: number;
  /** One per unit; `NO_VALUE` where nothing was given. */
  values: number[];
}

/** Stands for "no value given", which a colour scale draws differently from 0. */
const NO_VALUE = -1;

const EASING = Easing.out(Easing.cubic);

function MapCanvas({ body, values, level = 'muscles', colors, glow = true, animationDuration = 300, padding = 0, size }: MuscleMapProps & { size: Size }) {
  const scene = getBodyScene(body);
  ensureLevel(body, scene, level);
  const { rest, accent, inert, body: bodyColor } = colors;
  const stops = scaleKey(colors.scale);
  const brush = useMemo(
    () => createBrush(scene.outline, { rest, accent, inert, body: bodyColor, scale: stops ? stops.split('|') : undefined }),
    [scene, rest, accent, inert, bodyColor, stops],
  );
  // A fresh array whenever a level is first built, so the worklet below picks it up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const levels = useMemo(() => [...scene.levels], [scene, scene.version]);
  const resolved = useMemo<Shown>(
    () => ({ level: LEVELS.indexOf(level), values: resolveValues(getBodyModel(body), level, values, undefined, NO_VALUE) }),
    [body, level, values],
  );

  // `target` is what the props ask for. `shown` and `from` are what is being
  // drawn: `from` is the look of every region when the last change began (see
  // `regionLooks`), and it blends into the look of `shown.values` as
  // `progress` goes from 0 to 1. Empty means there is nothing to blend from.
  const target = useSharedValue(resolved);
  const shown = useSharedValue(resolved);
  const from = useSharedValue<number[]>([]);
  const progress = useSharedValue(1);

  useEffect(() => {
    target.value = resolved;
  }, [resolved, target]);

  useAnimatedReaction(
    () => target.value,
    (next, previous) => {
      if (previous === null || next === previous) return;
      const current = shown.value;
      const paths = levels[current.level];
      if (paths && animationDuration > 0 && current.level === next.level && current.values.length === next.values.length) {
        // Start from whatever is on screen now, so a change mid-fade does not jump.
        from.value = regionLooks(brush, paths.inert, from.value, current.values, progress.value);
        shown.value = next;
        progress.value = 0;
        progress.value = withTiming(1, { duration: animationDuration, easing: EASING });
      } else {
        // Units differ between levels, so there is nothing to blend.
        from.value = [];
        shown.value = next;
        progress.value = 1;
      }
    },
    [animationDuration, brush, levels],
  );

  const layout = fitBody(body, size.width, size.height, padding);
  const { scale, tx, ty } = layout;
  const recorder = useMemo(() => Skia.PictureRecorder(), []);
  const bounds = useMemo(() => Skia.XYWHRect(0, 0, size.width, size.height), [size.width, size.height]);

  // Re-recorded on the UI thread, and only when the values, the fade or the
  // inputs above change. Nothing runs per frame while the map is idle.
  const picture = useDerivedValue(() => {
    const { level: index, values: to } = shown.value;
    const canvas = recorder.beginRecording(bounds);
    const paths = levels[index];
    if (paths && scale > 0) {
      canvas.translate(tx, ty);
      canvas.scale(scale, scale);
      drawBody(canvas, brush, paths, regionLooks(brush, paths.inert, from.value, to, progress.value), glow);
    }
    return recorder.finishRecordingAsPicture();
  });

  // The canvas takes no touches: left as a touch target on iOS, it swallows the
  // taps meant for a Pressable around it, whether that is ours or, when there
  // is no `onRegionPress`, one of the app's. Skia's Android view ignores this prop.
  return (
    <Canvas style={{ width: size.width, height: size.height }} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}

/**
 * A body coloured by muscle intensity.
 *
 * It fills the size its `style` gives it and keeps the body's proportions.
 * Changes to `values` fade on the UI thread without re-rendering React.
 */
export const MuscleMap = memo(function MuscleMap(props: MuscleMapProps) {
  const { body, values, level = 'muscles', padding = 0, onRegionPress, style, accessibilityLabel } = props;
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
  }, []);

  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      if (!size || !onRegionPress) return;
      const paths = ensureLevel(body, getBodyScene(body), level);
      const layout = fitBody(body, size.width, size.height, padding);
      const index = hitTest(body, level, paths, layout, event.nativeEvent.locationX, event.nativeEvent.locationY);
      if (index < 0) return;
      const model = getBodyModel(body);
      const info = describeUnit(model, level, index);
      if (info) onRegionPress({ ...info, value: resolveValues(model, level, values)[index] ?? 0 });
    },
    [body, level, onRegionPress, padding, size, values],
  );

  // Keyed by body, so switching body starts clean instead of blending two different bodies.
  const map = size && size.width > 0 && size.height > 0 ? <MapCanvas key={getBodyScene(body).id} {...props} size={size} /> : null;
  if (!onRegionPress) {
    return (
      <View style={style} onLayout={onLayout} accessible={accessibilityLabel != null} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {map}
      </View>
    );
  }
  return (
    <Pressable style={style} onLayout={onLayout} onPress={onPress} accessibilityLabel={accessibilityLabel}>
      {/* A plain view applies pointerEvents on Android too, where the canvas does not, so the Pressable is the touch target on both platforms. */}
      <View pointerEvents="none" collapsable={false}>
        {map}
      </View>
    </Pressable>
  );
});
