import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, Pressable, Settings, Text, View } from 'react-native';
import { BenchScreen } from './src/bench/BenchScreen';
import { Demo } from './src/Demo';

// A launch argument shows up as a user default on iOS. `-benchCase <case>`
// opens the benchmarks and runs that case; see src/bench/BenchScreen.tsx.
const launchCase = Platform.OS === 'ios' ? Settings.get('benchCase') : undefined;
const initialCase = typeof launchCase === 'string' && launchCase ? launchCase : undefined;
// `-demoPreset Recovery -demoPalette scale -demoLevel groups` open the demo in that state.
const launchText = (key: string) => {
  const value = Platform.OS === 'ios' ? Settings.get(key) : undefined;
  return typeof value === 'string' && value ? value : undefined;
};
const demoLevel = launchText('demoLevel');

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
      {screen === 'demo' ? <Demo
          initialPreset={launchText('demoPreset')}
          initialPalette={launchText('demoPalette') === 'scale' ? 'scale' : 'accent'}
          initialLevel={demoLevel === 'groups' || demoLevel === 'parts' ? demoLevel : 'muscles'}
        /> : <BenchScreen initialCase={initialCase} />}
    </View>
  );
}
