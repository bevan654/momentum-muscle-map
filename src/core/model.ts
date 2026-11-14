import { MUSCLE_WEIGHTS, PARTS } from '../data/hierarchy';
import type { BodyData, BodyUnit, Level, MuscleValues, RegionInfo, Side } from './types';

/** The hierarchy group that holds tendons, fascia and the kneecap. */
export const NON_MUSCLE_GROUP = 'connective';

interface PartEntry {
  key: string;
  side: Side;
  muscle: string;
  group: string;
  /** Weight of the part within its muscle. */
  weight: number;
  /** Weight of the part's muscle within its group. */
  muscleWeight: number;
  isMuscle: boolean;
  /** Index of the unit that contains this part at the muscle and group levels. */
  muscleUnit: number;
  groupUnit: number;
}

/** A body with its hierarchy worked out once, ready for repeated lookups. */
export interface BodyModel {
  body: BodyData;
  /** @internal */
  parts: PartEntry[];
  /** @internal */
  info: Record<Level, RegionInfo[]>;
}

const SIDE_SUFFIX = /_(left|right)$/;

/** Splits `deltoid_anterior_left` into `deltoid_anterior` and `left`. */
export function splitId(id: string): { key: string; side: Side | undefined } {
  const m = SIDE_SUFFIX.exec(id);
  return m ? { key: id.slice(0, m.index), side: m[1] as Side } : { key: id, side: undefined };
}

function buildModel(body: BodyData): BodyModel {
  const unitIndex = (units: BodyUnit[]) => new Map(units.map((u, i) => [u.id, i]));
  const muscleIndex = unitIndex(body.muscles);
  const groupIndex = unitIndex(body.groups);
  const find = (index: Map<string, number>, id: string) => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`momentum-muscle-map: body data has no unit "${id}"`);
    return i;
  };

  const parts = body.parts.map((u): PartEntry => {
    const { key } = splitId(u.id);
    const entry = PARTS[key];
    if (!entry) throw new Error(`momentum-muscle-map: unknown part "${key}"`);
    const [muscle, group, weight] = entry;
    const isMuscle = group !== NON_MUSCLE_GROUP;
    // a non-muscle part stays its own unit at every level
    return {
      key,
      side: u.side,
      muscle,
      group,
      weight,
      muscleWeight: MUSCLE_WEIGHTS[muscle] ?? 1,
      isMuscle,
      muscleUnit: find(muscleIndex, `${muscle}_${u.side}`),
      groupUnit: find(groupIndex, `${isMuscle ? group : key}_${u.side}`),
    };
  });

  const partInfo = body.parts.map((u, i): RegionInfo => {
    const p = parts[i]!;
    return { id: u.id, key: p.key, side: u.side, level: 'parts', muscle: p.muscle, group: p.group, isMuscle: p.isMuscle };
  });
  const muscleInfo: RegionInfo[] = [];
  const groupInfo: RegionInfo[] = [];
  parts.forEach((p) => {
    muscleInfo[p.muscleUnit] ??= {
      id: body.muscles[p.muscleUnit]!.id,
      key: p.muscle,
      side: p.side,
      level: 'muscles',
      muscle: p.muscle,
      group: p.group,
      isMuscle: p.isMuscle,
    };
    groupInfo[p.groupUnit] ??= {
      id: body.groups[p.groupUnit]!.id,
      key: p.isMuscle ? p.group : p.key,
      side: p.side,
      level: 'groups',
      ...(p.isMuscle ? {} : { muscle: p.muscle }),
      group: p.group,
      isMuscle: p.isMuscle,
    };
  });
  return { body, parts, info: { parts: partInfo, muscles: muscleInfo, groups: groupInfo } };
}

const models = new WeakMap<BodyData, BodyModel>();

/** Returns the model for a body, building it on first use. */
export function getBodyModel(body: BodyData): BodyModel {
  let model = models.get(body);
  if (!model) {
    model = buildModel(body);
    models.set(body, model);
  }
  return model;
}

/** Describes the unit at `index` of a level: its key, side and place in the hierarchy. */
export function describeUnit(model: BodyModel, level: Level, index: number): RegionInfo | undefined {
  return model.info[level][index];
}

function lookup(values: MuscleValues, key: string, side: Side): number | undefined {
  let v = values[`${key}_${side}`];
  // a sided value that is not a usable number must not hide the unsided one
  if (typeof v !== 'number' || Number.isNaN(v)) v = values[key];
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Works out the intensity of every unit at a level, in the order of
 * `body[level]`.
 *
 * Each part takes the most specific value given for it: its own key, else its
 * muscle's, else its group's, else 0. A key with a side suffix beats the same
 * key without one. Values are clamped to 0..1.
 *
 * A muscle or group shows the strongest of its parts. A value that was given
 * at a finer level than the one being shown is scaled by the area weights on
 * the way up, so a small part at full intensity does not light a whole group
 * as strongly as a large one would. A value given at the shown level or above
 * is used as it is.
 *
 * Non-muscle units are always 0.
 *
 * Pass `out` to reuse an array between calls.
 */
export function resolveValues(model: BodyModel, level: Level, values: MuscleValues, out?: number[]): number[] {
  const n = model.body[level].length;
  const result = out ?? new Array<number>(n);
  result.length = n;
  result.fill(0);
  const { parts } = model;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p.isMuscle) continue;
    let v = lookup(values, p.key, p.side);
    let scaleToMuscle = 1;
    let scaleToGroup = 1;
    if (v !== undefined) {
      scaleToMuscle = p.weight;
      scaleToGroup = p.weight * p.muscleWeight;
    } else if ((v = lookup(values, p.muscle, p.side)) !== undefined) {
      scaleToGroup = p.muscleWeight;
    } else if ((v = lookup(values, p.group, p.side)) === undefined) {
      continue;
    }
    if (level === 'parts') {
      result[i] = v;
    } else if (level === 'muscles') {
      if (v * scaleToMuscle > result[p.muscleUnit]!) result[p.muscleUnit] = v * scaleToMuscle;
    } else if (v * scaleToGroup > result[p.groupUnit]!) {
      result[p.groupUnit] = v * scaleToGroup;
    }
  }
  return result;
}

/**
 * Indexes of the units whose bounding box contains a point, front-most first.
 * A renderer then checks the exact shape of each candidate in turn.
 */
export function candidatesAt(body: BodyData, level: Level, x: number, y: number): number[] {
  const units = body[level];
  const found: number[] = [];
  for (let i = units.length - 1; i >= 0; i--) {
    const bb = units[i]!.bb;
    if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]) found.push(i);
  }
  return found;
}

/** The complete SVG path of a unit, joined from the body's sub-path pool. */
export function unitPath(body: BodyData, unit: BodyUnit): string {
  let d = '';
  for (const i of unit.paths) d += body.paths[i];
  return d;
}
