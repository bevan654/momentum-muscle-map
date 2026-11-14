// Benchmark harness. Tap a case to run it, or start one from the host so a
// script can drive it and measure memory from outside (iOS simulator only):
//
//   xcrun simctl launch booted com.momentum.musclemap.example -benchCase <case>
//
// A case writes its result to bench-<case>.json in the app's documents folder.
import { File, Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Settings, Text, View } from 'react-native';
import maleFront from 'momentum-muscle-map/data/male-front';
import { Live } from './src/bench/Live';
import type { LiveVariant } from './src/bench/Live';
import { MiniList } from './src/bench/Mini';
import type { MiniVariant } from './src/bench/Mini';
import { COLORS } from './src/bench/scene';
import type { GlowMode } from './src/bench/scene';
import { drawCosts, setupCosts } from './src/bench/timed';

const CASES = [
  'setup',
  'draw',
  'live-static-none',
  'live-nodes-none',
  'live-nodes-mask',
  'live-nodes-layer',
  'live-picture-none',
  'live-picture-mask',
  'live-picture-layer',
  'mini-none-0',
  'mini-canvas-20',
  'mini-image-20',
  'mini-canvas-60',
  'mini-image-60',
] as const;

function save(name: string, result: unknown) {
  try {
    const file = new File(Paths.document, `bench-${name}.json`);
    if (!file.exists) file.create();
    file.write(JSON.stringify({ case: name, at: new Date().toISOString(), result }, null, 2));
  } catch (error) {
    console.warn('could not save result', error);
  }
}

export default function App() {
  const [current, setCurrent] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const finish = useCallback((name: string, result: unknown) => {
    save(name, result);
    setLog((lines) => [`${name}: ${JSON.stringify(result)}`, ...lines].slice(0, 30));
  }, []);

  const start = useCallback(
    (name: string) => {
      setCurrent(null);
      // let the previous case unmount before the next one starts
      setTimeout(() => {
        if (name === 'setup' || name === 'draw') {
          try {
            finish(name, name === 'setup' ? setupCosts(maleFront) : drawCosts(maleFront));
          } catch (error) {
            finish(name, { error: String(error) });
          }
        } else {
          setCurrent(name);
        }
      }, 300);
    },
    [finish],
  );

  useEffect(() => {
    // a launch argument shows up as a user default on iOS
    const name = Platform.OS === 'ios' ? Settings.get('benchCase') : undefined;
    if (typeof name === 'string' && name) start(name);
  }, [start]);

  const [kind, variant, option] = current?.split('-') ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: 60 }}>
      <StatusBar style="light" />
      {kind === 'live' ? (
        <Live
          key={current}
          body={maleFront}
          variant={variant as LiveVariant}
          glow={option as GlowMode}
          seconds={6}
          onDone={(result) => finish(current!, result)}
        />
      ) : kind === 'mini' ? (
        <MiniList key={current} body={maleFront} variant={variant as MiniVariant} count={Number(option)} onDone={(result) => finish(current!, result)} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '600' }}>Muscle map benchmarks</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CASES.map((name) => (
              <Pressable key={name} onPress={() => start(name)} style={{ backgroundColor: '#2A2A30', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: '#fff' }}>{name}</Text>
              </Pressable>
            ))}
          </View>
          {log.map((line, i) => (
            <Text key={i} style={{ color: '#9a9aa2', fontSize: 11 }}>
              {line}
            </Text>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
