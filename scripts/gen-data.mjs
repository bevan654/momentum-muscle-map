// Turns the pipeline's data.json into the TypeScript data modules in src/data.
//
//   node scripts/gen-data.mjs [--in pipeline/out/data.json] [--out src/data] [--encoding rel|abs]
//
// Two things keep the shipped data small:
//  1. Every body has one pool of unique sub-paths. Parts, muscles and groups
//     reference pool entries, so a muscle that is drawn exactly like its only
//     part (or a group that is the sum of whole source shapes) costs a few
//     integers and no second copy of the geometry.
//  2. Sub-paths are written with relative commands in the shortest SVG form.
//     Coordinates are kept in integer tenths while converting, so the result
//     decodes to exactly the coordinates the pipeline produced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const inFile = path.resolve(root, arg('in', 'pipeline/out/data.json'));
const outDir = path.resolve(root, arg('out', 'src/data'));
const encoding = arg('encoding', 'rel');

const TOKEN = /([MLCZ])|(-?\d*\.?\d+)/g;
const tenths = (s) => Math.round(parseFloat(s) * 10);

/** Absolute M/L/C/Z path -> sub-paths, each a list of [cmd, ...integer tenths]. */
export function parsePath(d) {
  const subs = [];
  let cur = null;
  let cmd = null;
  let nums = [];
  const need = { M: 2, L: 2, C: 6 };
  const flush = () => {
    if (!cmd || cmd === 'Z') return;
    const n = need[cmd];
    if (nums.length % n !== 0) throw new Error(`bad argument count for ${cmd}`);
    for (let i = 0; i < nums.length; i += n) {
      const seg = nums.slice(i, i + n);
      if (cmd === 'M' && i === 0) {
        cur = [['M', ...seg]];
        subs.push(cur);
      } else {
        cur.push([cmd === 'M' ? 'L' : cmd, ...seg]);
      }
    }
    nums = [];
  };
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      flush();
      cmd = m[1];
      if (cmd === 'Z') cur.push(['Z']);
    } else {
      nums.push(tenths(m[2]));
    }
  }
  flush();
  return subs;
}

const fmt = (v) => {
  const neg = v < 0;
  const a = Math.abs(v);
  const whole = Math.trunc(a / 10);
  const frac = a % 10;
  const body = frac === 0 ? String(whole) : (whole === 0 ? '' : String(whole)) + '.' + frac;
  return (neg ? '-' : '') + body;
};
const join = (vals) => {
  let out = '';
  vals.forEach((v, i) => {
    const s = fmt(v);
    out += i > 0 && s[0] !== '-' ? ' ' + s : s;
  });
  return out;
};

export function encodeAbs(sub) {
  return sub.map(([c, ...v]) => (c === 'Z' ? 'Z' : c + join(v))).join('');
}

export function encodeRel(sub) {
  let out = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let last = '';
  const emit = (c, vals) => {
    // a repeated command letter can be left out; the numbers just continue
    if (c === last) out += (fmt(vals[0])[0] === '-' ? '' : ' ') + join(vals);
    else out += c + join(vals);
    last = c;
  };
  for (const [c, ...v] of sub) {
    if (c === 'M') {
      out += 'M' + join(v);
      last = 'M*'; // never continue an M run: implicit pairs after M would be absolute
      [x, y] = v;
      [startX, startY] = v;
    } else if (c === 'L') {
      const dx = v[0] - x;
      const dy = v[1] - y;
      if (dy === 0) emit('h', [dx]);
      else if (dx === 0) emit('v', [dy]);
      else emit('l', [dx, dy]);
      [x, y] = v;
    } else if (c === 'C') {
      emit('c', [v[0] - x, v[1] - y, v[2] - x, v[3] - y, v[4] - x, v[5] - y]);
      x = v[4];
      y = v[5];
    } else {
      out += 'z';
      last = 'z';
      // closing a sub-path moves the current point back to where it started
      x = startX;
      y = startY;
    }
  }
  return out;
}

/** Decode the relative form back to absolute integer tenths (used to prove the encoding is lossless). */
export function decodeRel(s) {
  const out = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';
  let nums = [];
  const need = { M: 2, l: 2, h: 1, v: 1, c: 6 };
  const flush = () => {
    if (!cmd || cmd === 'z') return;
    const n = need[cmd];
    for (let i = 0; i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      if (cmd === 'M') {
        [x, y] = a;
        [startX, startY] = a;
        out.push(['M', x, y]);
      } else if (cmd === 'l') {
        x += a[0];
        y += a[1];
        out.push(['L', x, y]);
      } else if (cmd === 'h') {
        x += a[0];
        out.push(['L', x, y]);
      } else if (cmd === 'v') {
        y += a[0];
        out.push(['L', x, y]);
      } else {
        out.push(['C', x + a[0], y + a[1], x + a[2], y + a[3], x + a[4], y + a[5]]);
        x += a[4];
        y += a[5];
      }
    }
    nums = [];
  };
  for (const m of s.matchAll(/([Mlhvcz])|(-?\d*\.?\d+)/g)) {
    if (m[1]) {
      flush();
      cmd = m[1];
      if (cmd === 'z') {
        out.push(['Z']);
        x = startX;
        y = startY;
      }
    } else {
      nums.push(tenths(m[2]));
    }
  }
  flush();
  return out;
}

const encode = encoding === 'abs' ? encodeAbs : encodeRel;

function buildBody(body) {
  const pool = [];
  const index = new Map();
  const refs = (d) =>
    parsePath(d).map((sub) => {
      const s = encode(sub);
      if (encoding === 'rel' && JSON.stringify(decodeRel(s)) !== JSON.stringify(sub)) {
        throw new Error('relative encoding is not lossless');
      }
      if (!index.has(s)) {
        index.set(s, pool.length);
        pool.push(s);
      }
      return index.get(s);
    });
  const unit = (e) => ({ id: e.id, side: e.side, paths: refs(e.d), c: e.c, bb: e.bb });
  return {
    viewBox: body.viewBox.split(' ').map(Number),
    bounds: body.ob,
    outline: parsePath(body.outline).map(encode).join(''),
    paths: pool,
    parts: body.L3.map(unit),
    muscles: body.L2.map(unit),
    groups: body.L1.map(unit),
  };
}

const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

function main() {
  const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const banner =
    '// GENERATED by scripts/gen-data.mjs from the geometry pipeline. Do not edit by hand.\n' +
    '// Artwork derived from @musclemap/assets (MIT, Copyright (c) 2026 Jsplice / MuscleMap contributors). See NOTICE.\n';
  const report = [];
  for (const [name, body] of Object.entries(data.bodies)) {
    const out = buildBody(body);
    const json = JSON.stringify(out);
    fs.writeFileSync(
      path.join(outDir, `${name}.ts`),
      `${banner}import type { BodyData } from '../core/types';\n\nconst data: BodyData = ${json};\n\nexport default data;\n`,
    );
    report.push(
      `${name}: ${JSON.stringify(body).length} -> ${json.length} bytes, ${out.paths.length} pooled sub-paths, ` +
        `${out.parts.length}/${out.muscles.length}/${out.groups.length} parts/muscles/groups`,
    );
  }
  const parts = {};
  for (const [slug, h] of Object.entries(data.hier)) {
    parts[slug] = [h.muscle, h.group, data.pw[slug] ?? 1];
  }
  fs.writeFileSync(
    path.join(outDir, 'hierarchy.ts'),
    `${banner}\n/** part slug -> [muscle, group, weight of the part within its muscle] */\n` +
      `export const PARTS: Record<string, readonly [muscle: string, group: string, weight: number]> = ${JSON.stringify(parts)};\n\n` +
      `/** muscle slug -> weight of the muscle within its group */\n` +
      `export const MUSCLE_WEIGHTS: Record<string, number> = ${JSON.stringify(data.mw)};\n`,
  );
  console.log(report.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
