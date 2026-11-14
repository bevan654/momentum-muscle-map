// The library's own components under load: one full map whose values change
// every 400 ms (or never), with the accent ramp or a colour scale, and a list
// of feed-card maps, still or scrolling.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { MiniMuscleMap, MuscleMap } from 'momentum-muscle-map';
import type { MuscleMapColors } from 'momentum-muscle-map';
import maleFront from 'momentum-muscle-map/data/male-front';
import { COLORS, LEGS, PUSH, summarise } from './scene';

export type RendererVariant = 'idle' | 'animate' | 'scale' | 'mini' | 'scroll';

const MAP_COLORS: MuscleMapColors = { rest: COLORS.rest, accent: COLORS.accent, inert: COLORS.inert, body: COLORS.body };
const SCALE_COLORS: MuscleMapColors = { ...MAP_COLORS, scale: ['#22C55E', '#F59E0B', '#EF4444'] };

interface Props {
  variant: RendererVariant;
  count: number;
  seconds: number;
  onDone: (result: unknown) => void;
}

export function Renderer({ variant, count, seconds, onDone }: Props) {
  const [step, setStep] = useState(0);
  const frames = useSharedValue<number[]>([]);
  const started = useMemo(() => performance.now(), []);
  const list = useRef<ScrollView>(null);

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

  useEffect(() => {
    let down = false;
    const flip =
      variant === 'animate' || variant === 'scale'
        ? setInterval(() => setStep((s) => s + 1), 400)
        : variant === 'scroll'
          ? setInterval(() => list.current?.scrollTo({ y: (down = !down) ? 700 : 0, animated: true }), 600)
          : undefined;
    const timer = setTimeout(() => {
      const elapsed = (performance.now() - started) / 1000;
      const all = frames.value;
      const steady = all.slice(Math.min(all.length, 60));
      const stats = summarise(steady);
      onDone({
        variant,
        count,
        fps: Math.round((all.length / elapsed) * 10) / 10,
        frameMs: stats,
        // the longest gap in the first second, which is where a slow mount shows up
        worstFrameWhileMountingMs: Math.round(Math.max(0, ...all.slice(0, 60)) * 100) / 100,
        slowFramesPercent: Math.round((steady.filter((dt) => dt > stats.median * 1.5).length / Math.max(1, steady.length)) * 1000) / 10,
      });
    }, seconds * 1000);
    return () => {
      clearInterval(flip);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (variant === 'mini' || variant === 'scroll') {
    return (
      <ScrollView ref={list} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16 }}>
        {Array.from({ length: count }, (_, i) => (
          <MiniMuscleMap key={i} body={maleFront} values={i % 2 ? PUSH : LEGS} colors={MAP_COLORS} width={56} height={120} />
        ))}
      </ScrollView>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <MuscleMap body={maleFront} values={step % 2 ? LEGS : PUSH} level="parts" colors={variant === 'scale' ? SCALE_COLORS : MAP_COLORS} padding={12} style={{ flex: 1 }} />
    </View>
  );
}
