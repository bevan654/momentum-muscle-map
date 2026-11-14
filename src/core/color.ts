// Both functions are marked as worklets so a renderer can call them on the UI
// thread. Outside React Native the directive is an ordinary string and does nothing.

const STOPS = [0, 0.18, 0.42, 0.68, 1];
const MIX = [0, 0.12, 0.41, 0.75, 1];

/**
 * How far to blend from the resting colour to the accent colour for an
 * intensity. The curve keeps low intensities visibly distinct from zero
 * without washing out the top of the range.
 */
export function intensityMix(value: number): number {
  'worklet';
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  let i = 1;
  while (value > STOPS[i]!) i++;
  const t = (value - STOPS[i - 1]!) / (STOPS[i]! - STOPS[i - 1]!);
  return MIX[i - 1]! + (MIX[i]! - MIX[i - 1]!) * t;
}

/** Glow opacity for an intensity: none up to 0.6, then rising to 0.9. */
export function glowOpacity(value: number): number {
  'worklet';
  if (!(value > 0.6)) return 0;
  return Math.pow((Math.min(value, 1) - 0.6) / 0.4, 1.15) * 0.9;
}
