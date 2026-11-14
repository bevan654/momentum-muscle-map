import { Skia } from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';
import { describeUnit, getBodyModel, unitPath } from '../core';
import type { BodyData, Level } from '../core';

export const LEVELS: readonly Level[] = ['groups', 'muscles', 'parts'];

/** The Skia paths of one level of a body, in draw order. */
export interface LevelPaths {
  paths: SkPath[];
  /** True for units that never take a value (tendons, fascia, the kneecap). */
  inert: boolean[];
}

/**
 * The native paths of a body. They are built once per body and shared by
 * every map that shows it. Levels are built the first time they are needed.
 */
export interface BodyScene {
  /** Stable number for this body, usable as a React key. */
  id: number;
  outline: SkPath;
  /** Indexed like `LEVELS`. An entry is undefined until that level is first used. */
  levels: (LevelPaths | undefined)[];
  /** Goes up each time a level is built, so callers can tell the scene changed. */
  version: number;
}

const scenes = new WeakMap<BodyData, BodyScene>();
let nextId = 1;

function parse(d: string): SkPath {
  const path = Skia.Path.MakeFromSVGString(d);
  if (!path) throw new Error('momentum-muscle-map: body data contains a path Skia could not read');
  return path;
}

export function getBodyScene(body: BodyData): BodyScene {
  let scene = scenes.get(body);
  if (!scene) {
    scene = { id: nextId++, outline: parse(body.outline), levels: [undefined, undefined, undefined], version: 0 };
    scenes.set(body, scene);
  }
  return scene;
}

/** Makes sure a level's paths exist and returns them. */
export function ensureLevel(body: BodyData, scene: BodyScene, level: Level): LevelPaths {
  const index = LEVELS.indexOf(level);
  let built = scene.levels[index];
  if (!built) {
    const model = getBodyModel(body);
    built = {
      paths: body[level].map((unit) => parse(unitPath(body, unit))),
      inert: body[level].map((_, i) => !describeUnit(model, level, i)?.isMuscle),
    };
    scene.levels[index] = built;
    scene.version++;
  }
  return built;
}
