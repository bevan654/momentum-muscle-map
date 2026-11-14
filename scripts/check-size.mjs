// Fails if the generated body data is over the size budgets in CLAUDE.md.
// Sizes are measured as Hermes bytecode, which is what an app actually ships.
//
//   node scripts/check-size.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODIES = ['male-front', 'male-back', 'female-front', 'female-back'];
const PER_BODY_KB = 80;
const ALL_BODIES_KB = 300;

const platformDir = { darwin: 'osx-bin', linux: 'linux64-bin', win32: 'win64-bin' }[process.platform];
const hermesc = path.join(root, 'node_modules/react-native/sdks/hermesc', platformDir, process.platform === 'win32' ? 'hermesc.exe' : 'hermesc');
if (!fs.existsSync(hermesc)) {
  console.error(`hermesc not found at ${hermesc}. Run npm install first.`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-size-'));
const literal = (name) => {
  const src = fs.readFileSync(path.join(root, 'src/data', `${name}.ts`), 'utf8');
  return src.slice(src.indexOf('= {') + 2, src.lastIndexOf('};') + 1);
};
const bytecodeSize = (label, js) => {
  const input = path.join(tmp, `${label}.js`);
  const output = path.join(tmp, `${label}.hbc`);
  fs.writeFileSync(input, js);
  execFileSync(hermesc, ['-O', '-emit-binary', '-out', output, input]);
  return fs.statSync(output).size;
};

let failed = false;
const report = (label, bytes, budgetKb) => {
  const kb = bytes / 1024;
  const over = kb > budgetKb;
  failed ||= over;
  console.log(`${over ? 'OVER' : 'ok  '}  ${label.padEnd(14)} ${kb.toFixed(1).padStart(6)} KB  (budget ${budgetKb} KB)`);
};
try {
  const empty = bytecodeSize('empty', 'globalThis.d=1;');
  for (const name of BODIES) report(name, bytecodeSize(name, `globalThis.d=${literal(name)};`) - empty, PER_BODY_KB);
  report('all four', bytecodeSize('all', BODIES.map((n, i) => `globalThis.d${i}=${literal(n)};`).join('\n')) - empty, ALL_BODIES_KB);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
