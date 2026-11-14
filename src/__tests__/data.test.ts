import { describe, expect, it } from 'vitest';
import { MUSCLE_WEIGHTS, PARTS, getBodyModel, splitId, unitPath } from '../core';
import type { BodyData, Level } from '../core';
import femaleBack from '../data/female-back';
import femaleFront from '../data/female-front';
import maleBack from '../data/male-back';
import maleFront from '../data/male-front';

const bodies: Record<string, BodyData> = { maleFront, maleBack, femaleFront, femaleBack };
const levels: Level[] = ['parts', 'muscles', 'groups'];
const ids = (b: BodyData, level: Level) => b[level].map((u) => u.id).sort();

describe.each(Object.entries(bodies))('%s', (_name, body) => {
  it('has unique snake_case ids ending in a side', () => {
    for (const level of levels) {
      const list = ids(body, level);
      expect(new Set(list).size).toBe(list.length);
      for (const u of body[level]) {
        expect(u.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*_(left|right)$/);
        expect(splitId(u.id).side).toBe(u.side);
      }
    }
  });

  it('has the same units on the left and the right', () => {
    for (const level of levels) {
      const keys = (side: string) => body[level].filter((u) => u.side === side).map((u) => splitId(u.id).key).sort();
      expect(keys('left')).toEqual(keys('right'));
    }
  });

  it('only references sub-paths that exist, and uses every one', () => {
    const used = new Set<number>();
    for (const level of levels) {
      for (const u of body[level]) {
        expect(u.paths.length).toBeGreaterThan(0);
        for (const i of u.paths) {
          expect(body.paths[i]).toBeDefined();
          used.add(i);
        }
      }
    }
    expect(used.size).toBe(body.paths.length);
  });

  it('keeps every sub-path closed, relative and at one decimal place', () => {
    for (const d of [...body.paths, body.outline]) {
      expect(d).toMatch(/^M[-\d. ]+[lhvc]/);
      expect(d.endsWith('z')).toBe(true);
      expect(d).not.toMatch(/\.\d\d/);
    }
    expect(unitPath(body, body.parts[0]!)).toBe(body.parts[0]!.paths.map((i) => body.paths[i]).join(''));
  });

  it('keeps label points and bounding boxes inside the silhouette bounds', () => {
    const [x0, y0, x1, y1] = body.bounds;
    for (const level of levels) {
      for (const u of body[level]) {
        expect(u.bb[0]).toBeGreaterThanOrEqual(x0 - 1);
        expect(u.bb[1]).toBeGreaterThanOrEqual(y0 - 1);
        expect(u.bb[2]).toBeLessThanOrEqual(x1 + 1);
        expect(u.bb[3]).toBeLessThanOrEqual(y1 + 1);
        expect(u.c[0]).toBeGreaterThanOrEqual(u.bb[0]);
        expect(u.c[0]).toBeLessThanOrEqual(u.bb[2]);
        expect(u.c[1]).toBeGreaterThanOrEqual(u.bb[1]);
        expect(u.c[1]).toBeLessThanOrEqual(u.bb[3]);
      }
    }
  });

  it('builds a model, so every part is in the hierarchy and has its muscle and group unit', () => {
    const model = getBodyModel(body);
    expect(getBodyModel(body)).toBe(model);
    for (const level of levels) {
      expect(model.info[level].filter(Boolean)).toHaveLength(body[level].length);
      model.info[level].forEach((info, i) => expect(info.id).toBe(body[level][i]!.id));
    }
  });
});

describe('across bodies', () => {
  it('gives male and female the same ids for the same view', () => {
    for (const level of levels) {
      expect(ids(maleFront, level)).toEqual(ids(femaleFront, level));
      expect(ids(maleBack, level)).toEqual(ids(femaleBack, level));
    }
  });

  it('draws every part of the hierarchy in at least one view', () => {
    const drawn = new Set([...maleFront.parts, ...maleBack.parts].map((u) => splitId(u.id).key));
    expect([...drawn].sort()).toEqual(Object.keys(PARTS).sort());
  });

  it('has a weight between 0.7 and 1 for every part and muscle', () => {
    for (const [, , weight] of Object.values(PARTS)) {
      expect(weight).toBeGreaterThanOrEqual(0.7);
      expect(weight).toBeLessThanOrEqual(1);
    }
    const muscles = new Set(Object.values(PARTS).map(([muscle]) => muscle));
    expect(Object.keys(MUSCLE_WEIGHTS).sort()).toEqual([...muscles].sort());
  });
});
