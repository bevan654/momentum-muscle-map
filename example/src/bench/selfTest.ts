// Checks the hit test on the device, where the real Skia paths are available:
// each region's label point must find a region there, and a point far from the
// body must find nothing. It calls the hit test directly and sends no touches,
// so it does not show that a real tap reaches the map.
import { fitBody } from 'momentum-muscle-map';
import type { BodyData, Level } from 'momentum-muscle-map';
import femaleBack from 'momentum-muscle-map/data/female-back';
import femaleFront from 'momentum-muscle-map/data/female-front';
import maleBack from 'momentum-muscle-map/data/male-back';
import maleFront from 'momentum-muscle-map/data/male-front';
import { hitTest } from '../../../src/skia/hitTest';
import { ensureLevel, getBodyScene } from '../../../src/skia/scene';

const BODIES: Record<string, BodyData> = { maleFront, maleBack, femaleFront, femaleBack };
const LEVELS: Level[] = ['groups', 'muscles', 'parts'];

export function selfTest() {
  const problems: string[] = [];
  let taps = 0;
  let exact = 0;
  for (const [name, body] of Object.entries(BODIES)) {
    const layout = fitBody(body, 180, 420);
    for (const level of LEVELS) {
      const paths = ensureLevel(body, getBodyScene(body), level);
      body[level].forEach((unit, i) => {
        taps++;
        const found = hitTest(body, level, paths, layout, unit.c[0] * layout.scale + layout.tx, unit.c[1] * layout.scale + layout.ty);
        if (found === i) exact++;
        else if (found < 0) problems.push(`${name} ${level} ${unit.id}: nothing found at its label point`);
        // a different unit is acceptable only where the artwork overlaps and that unit is drawn on top
        else if (found < i) problems.push(`${name} ${level} ${unit.id}: found ${body[level][found]!.id}, which is drawn underneath`);
      });
      if (hitTest(body, level, paths, layout, 2, 2) !== -1) problems.push(`${name} ${level}: found a region in the corner`);
      if (hitTest(body, level, paths, { scale: 0, tx: 0, ty: 0 }, 50, 50) !== -1) problems.push(`${name} ${level}: found a region at zero scale`);
    }
  }
  return { taps, exact, problems };
}
