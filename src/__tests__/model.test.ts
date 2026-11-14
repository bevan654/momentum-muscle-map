import { describe, expect, it } from 'vitest';
import { MUSCLE_WEIGHTS, PARTS, candidatesAt, describeUnit, getBodyModel, glowOpacity, intensityMix, regionLooks, resolveValues, scaleColor, splitId } from '../core';
import type { Level, MuscleValues } from '../core';
import maleBack from '../data/male-back';
import maleFront from '../data/male-front';

const front = getBodyModel(maleFront);
const value = (level: Level, values: MuscleValues, id: string, model = front) => {
  const i = model.body[level].findIndex((u) => u.id === id);
  expect(i).toBeGreaterThanOrEqual(0);
  return resolveValues(model, level, values)[i]!;
};
const partWeight = (key: string) => PARTS[key]![2];

describe('splitId', () => {
  it('separates the side suffix', () => {
    expect(splitId('deltoid_anterior_left')).toEqual({ key: 'deltoid_anterior', side: 'left' });
    expect(splitId('chest')).toEqual({ key: 'chest', side: undefined });
  });
});

describe('resolveValues', () => {
  it('returns one value per unit, all zero when nothing is given', () => {
    for (const level of ['parts', 'muscles', 'groups'] as const) {
      const out = resolveValues(front, level, {});
      expect(out).toHaveLength(maleFront[level].length);
      expect(out.every((v) => v === 0)).toBe(true);
    }
  });

  it('passes a group value down to its muscles and parts unchanged', () => {
    const values = { chest: 0.8 };
    expect(value('groups', values, 'chest_left')).toBe(0.8);
    expect(value('muscles', values, 'pectoralis_major_right')).toBe(0.8);
    expect(value('parts', values, 'pectoralis_major_sternal_left')).toBe(0.8);
    expect(value('groups', values, 'quads_left')).toBe(0);
  });

  it('prefers the most specific key, and a sided key over an unsided one', () => {
    const values = { chest: 0.2, pectoralis_major: 0.5, pectoralis_major_sternal: 0.7, pectoralis_major_sternal_left: 0.9 };
    expect(value('parts', values, 'pectoralis_major_sternal_left')).toBe(0.9);
    expect(value('parts', values, 'pectoralis_major_sternal_right')).toBe(0.7);
    expect(value('parts', values, 'pectoralis_major_clavicular_left')).toBe(0.5);
  });

  it('rolls part values up as a weighted maximum', () => {
    const values = { pectoralis_major_clavicular: 1, pectoralis_major_sternal: 0.4 };
    const muscle = Math.max(partWeight('pectoralis_major_clavicular'), 0.4 * partWeight('pectoralis_major_sternal'));
    expect(value('muscles', values, 'pectoralis_major_left')).toBeCloseTo(muscle, 10);
    const group = Math.max(
      partWeight('pectoralis_major_clavicular') * MUSCLE_WEIGHTS.pectoralis_major!,
      0.4 * partWeight('pectoralis_major_sternal') * MUSCLE_WEIGHTS.pectoralis_major!,
    );
    expect(value('groups', values, 'chest_left')).toBeCloseTo(group, 10);
  });

  it('does not weight a value given at the level being shown', () => {
    expect(value('muscles', { brachialis: 1 }, 'brachialis_left')).toBe(1);
    expect(value('groups', { brachialis: 1 }, 'arms_left')).toBeCloseTo(MUSCLE_WEIGHTS.brachialis!, 10);
    expect(MUSCLE_WEIGHTS.brachialis).toBeLessThan(1);
  });

  it('keeps left and right independent', () => {
    const values = { quads_left: 0.9, quads_right: 0.3 };
    expect(value('groups', values, 'quads_left')).toBe(0.9);
    expect(value('groups', values, 'quads_right')).toBe(0.3);
  });

  it('clamps values and ignores ones that are not numbers', () => {
    expect(value('groups', { chest: 7 }, 'chest_left')).toBe(1);
    expect(value('groups', { chest: -3 }, 'chest_left')).toBe(0);
    expect(value('groups', { chest: Number.NaN }, 'chest_left')).toBe(0);
    expect(value('groups', { chest: undefined, chest_left: 0.5 }, 'chest_left')).toBe(0.5);
    expect(value('groups', { chest: 0.5, chest_left: Number.NaN }, 'chest_left')).toBe(0.5);
    expect(value('groups', { chest: null } as unknown as MuscleValues, 'chest_left')).toBe(0);
  });

  it('never lights non-muscle units', () => {
    const back = getBodyModel(maleBack);
    const values = { achilles_tendon: 1, connective: 1, thoracolumbar_fascia_left: 1, calves: 1 };
    for (const level of ['parts', 'muscles', 'groups'] as const) {
      expect(value(level, values, 'achilles_tendon_left', back)).toBe(0);
      expect(value(level, values, 'thoracolumbar_fascia_left', back)).toBe(0);
    }
    expect(value('groups', values, 'calves_left', back)).toBe(1);
  });

  it('reuses the array it is given', () => {
    const out: number[] = [];
    expect(resolveValues(front, 'groups', { chest: 1 }, out)).toBe(out);
    resolveValues(front, 'parts', {}, out);
    expect(out).toHaveLength(maleFront.parts.length);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('describeUnit', () => {
  it('reports the hierarchy at each level', () => {
    const at = (level: Level, id: string) => describeUnit(front, level, maleFront[level].findIndex((u) => u.id === id));
    expect(at('parts', 'pectoralis_major_sternal_left')).toEqual({
      id: 'pectoralis_major_sternal_left',
      key: 'pectoralis_major_sternal',
      side: 'left',
      level: 'parts',
      muscle: 'pectoralis_major',
      group: 'chest',
      isMuscle: true,
    });
    expect(at('muscles', 'pectoralis_major_right')).toMatchObject({ key: 'pectoralis_major', group: 'chest', level: 'muscles' });
    expect(at('groups', 'chest_right')).toEqual({ id: 'chest_right', key: 'chest', side: 'right', level: 'groups', group: 'chest', isMuscle: true });
    expect(at('groups', 'patella_left')).toMatchObject({ key: 'patella', group: 'connective', isMuscle: false });
    expect(describeUnit(front, 'parts', 999)).toBeUndefined();
  });
});

describe('candidatesAt', () => {
  it('finds the unit under its own label point, front-most first', () => {
    for (const level of ['parts', 'groups'] as const) {
      maleFront[level].forEach((u, i) => expect(candidatesAt(maleFront, level, u.c[0], u.c[1])).toContain(i));
    }
    const found = candidatesAt(maleFront, 'parts', maleFront.parts[0]!.c[0], maleFront.parts[0]!.c[1]);
    expect([...found].sort((a, b) => b - a)).toEqual(found);
  });

  it('finds nothing outside the body', () => {
    expect(candidatesAt(maleFront, 'parts', 5, 5)).toEqual([]);
  });
});

describe('colour curves', () => {
  it('runs from 0 to 1 without going backwards', () => {
    expect(intensityMix(0)).toBe(0);
    expect(intensityMix(-1)).toBe(0);
    expect(intensityMix(Number.NaN)).toBe(0);
    expect(intensityMix(1)).toBe(1);
    expect(intensityMix(4)).toBe(1);
    let last = 0;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const m = intensityMix(v);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  it('only glows above 0.6', () => {
    expect(glowOpacity(0.6)).toBe(0);
    expect(glowOpacity(0.3)).toBe(0);
    expect(glowOpacity(1)).toBeCloseTo(0.9, 10);
    expect(glowOpacity(2)).toBeCloseTo(0.9, 10);
    expect(glowOpacity(0.8)).toBeGreaterThan(0);
  });
});

describe('resolveValues with a missing marker', () => {
  it('marks muscles without a value and keeps an explicit 0', () => {
    const values = { chest: 0, biceps_brachii_left: 0.4 };
    const out = (level: Level, id: string) => resolveValues(front, level, values, undefined, -1)[maleFront[level].findIndex((u) => u.id === id)]!;
    for (const level of ['groups', 'muscles', 'parts'] as const) {
      expect(out(level, level === 'groups' ? 'chest_left' : level === 'muscles' ? 'pectoralis_major_left' : 'pectoralis_major_sternal_left')).toBe(0);
      expect(out(level, level === 'groups' ? 'quads_left' : level === 'muscles' ? 'rectus_femoris_left' : maleFront.parts.find((u) => PARTS[splitId(u.id).key]![0] === 'rectus_femoris')!.id)).toBe(-1);
    }
    expect(out('muscles', 'biceps_brachii_left')).toBe(0.4);
    expect(out('muscles', 'biceps_brachii_right')).toBe(-1);
  });

  it('keeps non-muscle units at 0 at every level', () => {
    for (const level of ['groups', 'muscles', 'parts'] as const) {
      const out = resolveValues(front, level, {}, undefined, -1);
      maleFront[level].forEach((_, i) => {
        expect(out[i]).toBe(describeUnit(front, level, i)!.isMuscle ? -1 : 0);
      });
    }
  });

  it('rolls a part value up over missing siblings', () => {
    const part = maleFront.parts.find((u) => PARTS[splitId(u.id).key]![1] === 'chest')!;
    const key = splitId(part.id).key;
    const out = resolveValues(front, 'groups', { [key]: 0 }, undefined, -1);
    expect(out[maleFront.groups.findIndex((u) => u.id === `chest_${splitId(part.id).side}`)]).toBe(0);
  });
});

describe('scaleColor', () => {
  const stops = [0, 1, 0, 1, 0.5, 0, 1, 0, 0]; // green, orange, red
  const at = (v: number) => {
    const out: number[] = [];
    scaleColor(stops, v, out, 0);
    return out;
  };
  it('gives the stops at their positions and blends between neighbours', () => {
    expect(at(0)).toEqual([0, 1, 0]);
    expect(at(0.5)).toEqual([1, 0.5, 0]);
    expect(at(1)).toEqual([1, 0, 0]);
    expect(at(0.25)).toEqual([0.5, 0.75, 0]);
    expect(at(0.75)).toEqual([1, 0.25, 0]);
  });
  it('clamps values outside 0..1 and handles two stops', () => {
    expect(at(-3)).toEqual([0, 1, 0]);
    expect(at(7)).toEqual([1, 0, 0]);
    const out: number[] = [];
    scaleColor([0, 0, 0, 1, 1, 1], 0.5, out, 0);
    expect(out).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('regionLooks', () => {
  const rest = [0.2, 0.2, 0.2];
  const accent = [1, 0.4, 0.2];
  const scale = [0, 1, 0, 1, 0, 0];
  const skip = [false, false, true];

  it('runs from rest to accent without a scale, as intensityMix says', () => {
    const looks = regionLooks({ rest, accent, scale: null }, skip, [], [0, 1, 0], 1);
    expect(looks).toHaveLength(12);
    expect(looks.slice(0, 4)).toEqual([0.2, 0.2, 0.2, 0]);
    expect(looks.slice(4, 7)).toEqual([1, 0.4, 0.2]);
    expect(looks[7]).toBeCloseTo(0.9);
    expect(looks.slice(8)).toEqual([0, 0, 0, 0]);
    const half = regionLooks({ rest, accent, scale: null }, skip, [], [0.5, -1, 0], 1);
    expect(half[0]).toBeCloseTo(0.2 + 0.8 * intensityMix(0.5));
    expect(half.slice(4, 8)).toEqual([0.2, 0.2, 0.2, 0]);
  });

  it('uses the scale for a value and rest for no value', () => {
    const looks = regionLooks({ rest, accent, scale }, skip, [], [0, -1, 0], 1);
    expect(looks.slice(0, 4)).toEqual([0, 1, 0, 0]);
    expect(looks.slice(4, 8)).toEqual([0.2, 0.2, 0.2, 0]);
  });

  it('blends from an earlier look, glow included', () => {
    const palette = { rest, accent, scale };
    const before = regionLooks(palette, skip, [], [-1, 1, 0], 1);
    const mid = regionLooks(palette, skip, before, [1, 0, 0], 0.5);
    expect(mid[0]).toBeCloseTo(0.6);
    expect(mid[1]).toBeCloseTo(0.1);
    expect(mid[3]).toBeCloseTo(0.45);
    expect(mid[7]).toBeCloseTo(0.45);
    expect(regionLooks(palette, skip, before, [1, 0, 0], 1).slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('draws everything at rest when the values do not match the level', () => {
    const looks = regionLooks({ rest, accent, scale }, skip, [], [1], 1);
    expect(looks.slice(0, 4)).toEqual([0.2, 0.2, 0.2, 0]);
    expect(looks.slice(4, 8)).toEqual([0.2, 0.2, 0.2, 0]);
  });
});
