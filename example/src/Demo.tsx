// Manual test screen for the renderer: front and back maps, the three levels,
// a few value presets, the accent ramp or a colour scale, tap feedback and a row of feed-card maps.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MiniMuscleMap, MuscleMap } from 'momentum-muscle-map';
import type { Level, MuscleMapColors, MuscleValues, PressedRegion } from 'momentum-muscle-map';
import femaleBack from 'momentum-muscle-map/data/female-back';
import femaleFront from 'momentum-muscle-map/data/female-front';
import maleBack from 'momentum-muscle-map/data/male-back';
import maleFront from 'momentum-muscle-map/data/male-front';

const COLORS: MuscleMapColors = { rest: '#2F2F35', accent: '#FF6B35', inert: '#27272C', body: '#1C1C20' };
const BLUE: MuscleMapColors = { ...COLORS, accent: '#3B82F6' };
// Recovery colours: a value of 0 is ready (green), 1 is fatigued (red), no value stays grey.
const SCALE: MuscleMapColors = { ...COLORS, scale: ['#22C55E', '#F59E0B', '#EF4444'] };

const PRESETS: Record<string, MuscleValues> = {
  None: {},
  Push: { chest: 1, deltoid_anterior: 0.85, shoulders: 0.5, triceps_brachii: 0.8, core: 0.3 },
  Pull: { back: 1, traps: 0.7, biceps_brachii: 0.85, forearms: 0.5, deltoid_posterior: 0.6 },
  Legs: { quads: 1, glutes: 0.8, hamstrings: 0.9, adductors: 0.5, calves: 0.6, core: 0.4 },
  Imbalance: { quads_left: 1, quads_right: 0.4, biceps_brachii_left: 0.3, biceps_brachii_right: 0.9 },
  Recovery: { chest: 0.9, shoulders: 0.6, triceps_brachii: 0.75, core: 0.3, quads: 0, hamstrings: 0, glutes: 0.1, back: 0.45, biceps_brachii: 0 },
};
const LEVEL_NAMES: Level[] = ['groups', 'muscles', 'parts'];

function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={{ backgroundColor: option === value ? '#FF6B35' : '#2A2A30', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 }}
        >
          <Text style={{ color: '#fff', fontSize: 13 }}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Demo({ initialPreset = 'Push', initialLevel = 'muscles', initialPalette = 'accent' }: { initialPreset?: string; initialLevel?: Level; initialPalette?: 'accent' | 'scale' }) {
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [level, setLevel] = useState<Level>(initialLevel);
  const [preset, setPreset] = useState(initialPreset in PRESETS ? initialPreset : 'Push');
  const [palette, setPalette] = useState<'accent' | 'scale'>(initialPalette);
  const [pressed, setPressed] = useState<PressedRegion | null>(null);
  const colors = palette === 'scale' ? SCALE : COLORS;
  const values = PRESETS[preset]!;
  const front = sex === 'male' ? maleFront : femaleFront;
  const back = sex === 'male' ? maleBack : femaleBack;
  const minis = useMemo(() => Object.entries(PRESETS).filter(([name]) => name !== 'None'), []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Chips options={['male', 'female'] as const} value={sex} onChange={setSex} />
      <Chips options={LEVEL_NAMES} value={level} onChange={setLevel} />
      <Chips options={Object.keys(PRESETS)} value={preset} onChange={setPreset} />
      <Chips options={['accent', 'scale'] as const} value={palette} onChange={setPalette} />
      <View style={{ flexDirection: 'row', height: 420 }}>
        <MuscleMap body={front} values={values} level={level} colors={colors} onRegionPress={setPressed} style={{ flex: 1 }} accessibilityLabel="Front of body" />
        <MuscleMap body={back} values={values} level={level} colors={colors} onRegionPress={setPressed} style={{ flex: 1 }} accessibilityLabel="Back of body" />
      </View>
      <Text style={{ color: '#9a9aa2', fontSize: 13, minHeight: 34 }}>
        {pressed
          ? `${pressed.id}  ·  ${pressed.level}  ·  group ${pressed.group}  ·  ${pressed.isMuscle ? pressed.value.toFixed(2) : 'not a muscle'}`
          : 'Tap a region'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {minis.map(([name, v], i) => (
          <View key={name} style={{ alignItems: 'center', gap: 4 }}>
            <MiniMuscleMap body={i % 2 ? back : front} values={v} colors={palette === 'scale' ? SCALE : i === 3 ? BLUE : COLORS} width={56} height={120} />
            <Text style={{ color: '#9a9aa2', fontSize: 11 }}>{name}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
