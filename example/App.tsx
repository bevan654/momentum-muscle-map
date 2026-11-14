import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, Pressable, Settings, Text, View } from 'react-native';
import { BenchScreen } from './src/bench/BenchScreen';
import { Demo } from './src/Demo';

// A launch argument shows up as a user default on iOS. `-benchCase <case>`
// opens the benchmarks and runs that case; see src/bench/BenchScreen.tsx.
const launchCase = Platform.OS === 'ios' ? Settings.get('benchCase') : undefined;
const initialCase = typeof launchCase === 'string' && launchCase ? launchCase : undefined;

export default function App() {
  const [screen, setScreen] = useState<'demo' | 'bench'>(initialCase ? 'bench' : 'demo');
  return (
    <View style={{ flex: 1, backgroundColor: '#0D0D0F', paddingTop: 60 }}>
      <StatusBar style="light" />
      <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingBottom: 8 }}>
        {(['demo', 'bench'] as const).map((name) => (
          <Pressable key={name} onPress={() => setScreen(name)} hitSlop={8}>
            <Text style={{ color: screen === name ? '#fff' : '#6b6b73', fontSize: 17, fontWeight: '600' }}>{name === 'demo' ? 'Demo' : 'Benchmarks'}</Text>
          </Pressable>
        ))}
      </View>
      {screen === 'demo' ? <Demo /> : <BenchScreen initialCase={initialCase} />}
    </View>
  );
}
