// The functions are marked as worklets so a renderer can call them on the UI
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

/** The colours a value is turned into, as RGB components from 0 to 1. */
export interface Palette {
  /** A muscle at intensity 0, or with no value when there is a scale. */
  rest: ArrayLike<number>;
  /** A muscle at intensity 1. Not used when there is a scale. */
  accent: ArrayLike<number>;
  /** Two or more colours spread evenly over 0..1, as r, g, b for each in turn. */
  scale: ArrayLike<number> | null;
}

/**
 * Writes the colour of a value on a scale into `out[offset]` to
 * `out[offset + 2]`. `stops` holds r, g, b for each colour; the colours sit at
 * even steps from 0 to 1 and the value is blended between its two neighbours.
 */
export function scaleColor(stops: ArrayLike<number>, value: number, out: number[], offset: number): void {
  'worklet';
  const last = stops.length / 3 - 1;
  const position = (value > 0 ? (value < 1 ? value : 1) : 0) * last;
  const i = position >= last ? last - 1 : Math.floor(position);
  const t = position - i;
  const a = i * 3;
  out[offset] = stops[a]! + (stops[a + 3]! - stops[a]!) * t;
  out[offset + 1] = stops[a + 1]! + (stops[a + 4]! - stops[a + 1]!) * t;
  out[offset + 2] = stops[a + 2]! + (stops[a + 5]! - stops[a + 2]!) * t;
}

/**
 * Works out what every unit of a level looks like: four numbers per unit, its
 * r, g, b and its glow opacity.
 *
 * `to` holds the unit values (negative for "no value"). Without a scale a unit
 * runs from `rest` to `accent`. With one, a unit with a value takes its colour
 * from the scale and a unit without one is `rest`.
 *
 * If `from` is an earlier result for the same units and `t` is below 1, the
 * result is `from` blended towards the new look by `t`, which is how a change
 * of values fades. Units marked in `skip` are left at 0; if `to` does not
 * match the level every unit is at rest.
 */
export function regionLooks(palette: Palette, skip: ArrayLike<boolean>, from: number[], to: number[], t: number): number[] {
  'worklet';
  const n = skip.length;
  const looks = new Array<number>(n * 4).fill(0);
  const usable = to.length === n;
  const blend = usable && from.length === n * 4 && t < 1;
  const { rest, accent, scale } = palette;
  for (let i = 0; i < n; i++) {
    if (skip[i]) continue;
    const o = i * 4;
    const v = usable ? to[i]! : -1;
    if (scale !== null && v >= 0) {
      scaleColor(scale, v, looks, o);
    } else {
      const f = scale === null ? intensityMix(v) : 0;
      looks[o] = rest[0]! + (accent[0]! - rest[0]!) * f;
      looks[o + 1] = rest[1]! + (accent[1]! - rest[1]!) * f;
      looks[o + 2] = rest[2]! + (accent[2]! - rest[2]!) * f;
    }
    looks[o + 3] = glowOpacity(v);
    if (blend) {
      for (let k = o; k < o + 4; k++) looks[k] = from[k]! + (looks[k]! - from[k]!) * t;
    }
  }
  return looks;
}
