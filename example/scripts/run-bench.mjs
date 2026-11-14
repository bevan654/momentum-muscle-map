// Drives the benchmark app on a booted iOS simulator and prints the results.
//
//   node scripts/run-bench.mjs [case ...]      (no arguments runs every case)
//
// The app must already be installed as a release build:
//   npx expo run:ios --configuration Release
//
// Every case reports what the app measured. On-screen cases also record the
// app's memory footprint as macOS sees it, taken once the screen has settled.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BUNDLE = 'com.momentum.musclemap.example';
// Set BENCH_DEVICE to a simulator's id when more than one is booted.
const DEVICE = process.env.BENCH_DEVICE || 'booted';
const TIMED = ['setup', 'draw', 'selftest'];
const LIVE = ['live-static-none', 'live-nodes-none', 'live-nodes-mask', 'live-nodes-layer', 'live-picture-none', 'live-picture-mask', 'live-picture-layer'];
const MEMORY = ['mini-none-0', 'mini-canvas-20', 'mini-image-20', 'mini-canvas-60', 'mini-image-60'];
const RENDERER = ['renderer-idle-1', 'renderer-animate-1', 'renderer-scale-1', 'renderer-mini-20', 'renderer-mini-60', 'renderer-scroll-60'];
const cases = process.argv.length > 2 ? process.argv.slice(2) : [...TIMED, ...LIVE, ...MEMORY, ...RENDERER];

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const simctl = (...args) => sh('xcrun', ['simctl', ...args]);

function pid() {
  const line = simctl('spawn', DEVICE, 'launchctl', 'list').split('\n').find((l) => l.includes(BUNDLE));
  return line ? Number(line.trim().split(/\s+/)[0]) : NaN;
}

function footprintMb() {
  const id = pid();
  // the app is not running, for example because the case crashed it
  if (!Number.isInteger(id)) return NaN;
  const out = sh('footprint', [String(id)]);
  const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(out) ?? /phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(out);
  if (!m) return NaN;
  const scale = { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]];
  return Math.round(Number(m[1]) * scale * 10) / 10;
}

function launch(name) {
  try {
    simctl('terminate', DEVICE, BUNDLE);
  } catch {
    // not running
  }
  simctl('launch', DEVICE, BUNDLE, '-benchCase', name);
}

async function run(name, documents) {
  const file = path.join(documents, `bench-${name}.json`);
  fs.rmSync(file, { force: true });
  // every case runs in a fresh process, so one case cannot affect the next
  launch(name);
  const deadline = Date.now() + 120_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) return { error: 'timed out' };
    await sleep(500);
  }
  await sleep(300);
  const { result } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!TIMED.includes(name)) {
    // the case stays on screen after it reports, so this is its settled memory
    await sleep(MEMORY.includes(name) ? 5000 : 1000);
    result.footprintMb = footprintMb();
  }
  return result;
}

const documents = path.join(simctl('get_app_container', DEVICE, BUNDLE, 'data'), 'Documents');
const results = {};
for (const name of cases) {
  results[name] = await run(name, documents);
  console.error(`${name}: ${JSON.stringify(results[name])}`);
}
console.log(JSON.stringify(results, null, 2));
