# momentum-muscle-map

A detailed, interactive muscle map for React Native, built for the Momentum fitness app and kept as a separate library so it can be developed, measured and versioned on its own.

It draws a front and back body (male and female) split into about 70 regions per side, and colours each region by an intensity value from 0 to 1. Regions are organised in three levels, so the same data can be shown coarse or fine:

| Level | Example | Count |
|---|---|---|
| Group | `chest` | 13, plus non-muscle |
| Muscle | `pectoralis_major` | 40, plus 3 non-muscle |
| Part | `pectoralis_major_sternal` | 65 |

Every region id is snake_case and ends in `_left` or `_right`, meaning the subject's left or right.

## Status

Version 0.1: the data, the core logic and the Skia renderer exist. The renderer draws the heatmap with animated transitions and glow at three levels, reports taps, and has a small static map for feed cards. Zoom, pan and the close-up view from the HTML prototype are not built.

Known gaps:

- **Cost of mounting a map on a phone is not measured.** Each time a map mounts or its size, colours or glow setting change, Reanimated inspects everything the drawing worklet captured, including every Skia path of the level. The simulator shows no problem, but this has not been timed on a real phone.
- **Touch delivery has no automated test.** Version 0.1.0 shipped with taps that never reached `onRegionPress` on iOS, because the canvas took the touch. Now the canvases ignore touches on iOS (Skia's Android view drops that setting), and `MuscleMap` also wraps its canvas in a plain view that ignores touches, which React Native applies on both platforms. The canvas setting alone was confirmed with real taps on the iOS simulator in a consuming app; the wrapper, the example app and Android have not been tapped. Nothing in this repo sends a real touch, so tap the example app by hand after changing how the map is mounted. On Android, a pressable card around a `MiniMuscleMap` has not been tried; if its taps are lost, wrap the map in `<View pointerEvents="none">` inside the card, as `MuscleMap` does.
- **Android is not benchmarked.** No Android device or emulator has been used yet. Rendering numbers so far come from the iPhone simulator only, so run the example app's benchmark on a real Android phone before relying on them.

## How it is structured

```
/
├── CLAUDE.md            # This file: what the project is, how it is laid out, and the rules
├── pipeline/            # Build-time geometry pipeline (Python + shapely). Not shipped to apps.
│   ├── mm.py            # Reads the source artwork as text and parses SVG paths
│   ├── geo.py           # Geometry helpers: frames, cuts, splits, left/right pairing
│   ├── build.py         # The muscle hierarchy and the recipe for each of the four bodies
│   ├── export.py        # Validation and export to pipeline/out/data.json
│   ├── vendor/          # Unpacked @musclemap/assets (gitignored, downloaded locally)
│   └── out/             # Pipeline output (gitignored)
├── NOTICE               # MIT notice for the source artwork. Ships with the package.
├── scripts/
│   ├── gen-data.mjs     # Turns pipeline output into the compact data modules in src/data
│   └── check-size.mjs   # Fails if the data is over the size budgets in Targets
├── src/                 # The library
│   ├── index.ts         # Package entry point
│   ├── data/            # Generated: one module per body, plus the hierarchy. Never edit by hand.
│   ├── core/            # Pure TypeScript: types, value roll-up, colour curves, hit-test candidates
│   ├── skia/            # React Native Skia renderer: MuscleMap, MiniMuscleMap, drawing, hit-testing
│   └── __tests__/       # Tests for the data and the core
└── .github/workflows/   # CI: type-check, tests, size check, build, example type-check
```

`example/` is an Expo app used for manual testing and benchmarks. It has its own `package.json` and imports the library straight from `../src`.

```
example/
├── App.tsx              # Switches between the demo and the benchmarks
├── src/Demo.tsx         # Manual test screen for the renderer
├── metro.config.js      # Resolves momentum-muscle-map to ../src
├── scripts/run-bench.mjs  # Drives every case on a booted iOS simulator and prints the results
└── src/bench/           # The benchmark harness and its cases, including an on-device tap self-test
```

### Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks `src` |
| `npm test` | Runs the tests |
| `npm run check:size` | Compiles the data to Hermes bytecode and checks it against the budgets |
| `npm run build` | Builds `lib/` with react-native-builder-bob |
| `npm run gen:data` | Regenerates `src/data` from `pipeline/out/data.json` |

### Entry points

| Import | Contents |
|---|---|
| `momentum-muscle-map` | The renderer (`MuscleMap`, `MiniMuscleMap`) and the core |
| `momentum-muscle-map/core` | The core only, with no React Native imports |
| `momentum-muscle-map/data/male-front` (and `male-back`, `female-front`, `female-back`) | One body's data, so an app loads only the bodies it shows |

### The three layers

1. **Data** (`src/data`): plain data, generated by the pipeline. No logic.
2. **Core** (`src/core`): pure functions with no dependencies and no React.
3. **Renderer** (`src/skia`): the only layer that knows about React Native.

Lower layers never import from higher ones.

### Where the artwork comes from

The body outline and muscle shapes are derived from [`@musclemap/assets`](https://www.npmjs.com/package/@musclemap/assets) 1.1.0 (MIT, Copyright (c) 2026 Jsplice / MuscleMap contributors). The pipeline reads that package as data, splits its shapes into finer regions, and draws in a few muscles the source art does not have. The MIT notice must stay with any distributed copy of the data.

### Regenerating the data

```sh
# 1. Fetch the source artwork (read as text, never executed)
mkdir -p pipeline/vendor/musclemap
npm pack @musclemap/assets@1.1.0 --pack-destination pipeline/vendor
tar -xzf pipeline/vendor/musclemap-assets-1.1.0.tgz -C pipeline/vendor/musclemap

# 2. Run the pipeline (needs Python 3 with shapely and numpy)
python3 -I pipeline/export.py

# 3. Generate the data modules
npm run gen:data
```

The pipeline fails if any of its checks fail. It checks that split pieces tile their source shape (area sum within ±0.5%), that regions do not overlap beyond what the source art already has, that drawn regions stay inside the silhouette, and that the male and female bodies expose the same region ids.

### Using it

```tsx
import { MuscleMap, MiniMuscleMap } from 'momentum-muscle-map';
import maleFront from 'momentum-muscle-map/data/male-front';

// Defined once, outside the component, so they are the same objects on every render.
const colors = { rest: '#2F2F35', accent: '#FF6B35', inert: '#27272C', body: '#1C1C20' };
const values = { chest: 1, deltoid_anterior: 0.85, triceps_brachii_left: 0.4 };

<MuscleMap
  body={maleFront}
  values={values}
  level="muscles"
  colors={colors}
  onRegionPress={(region) => console.log(region.id, region.value)}
  style={{ flex: 1 }}
/>

<MiniMuscleMap body={maleFront} values={values} colors={colors} width={56} height={120} />
```

- **Values** are keyed by a group, muscle or part, with or without `_left` / `_right`. The most specific key wins. Coarser levels show the strongest of their parts, weighted by area. Values are clamped to 0..1 and non-muscle regions never light up.
- **Colours** all come from the app, so the library has no theme of its own.
- **Changes to `values`** fade over `animationDuration` (300 ms by default) on the UI thread. Changing `level` or `body` switches at once, because the regions are different.
- **Keep `values` and `colors` stable between renders** (`useMemo` or a constant). A new object each render makes the map resolve and redraw each render.
- **Space around the body** comes from the `padding` prop. Padding or borders in `style` are not supported: they offset the drawing and the tap positions.
- **`MiniMuscleMap`** is drawn at group level with no glow, animation or touch handling, and takes a fixed `width` and `height` so a list can lay it out without measuring.

## Targets

These are what the library is built and reviewed against.

| Target | Budget |
|---|---|
| Runtime dependencies | None. React, React Native, Skia and Reanimated are peer dependencies. |
| Native code | None, so the library can ship in an over-the-air update. |
| Data for one body, as Hermes bytecode | 80 KB or less (currently 62 to 72 KB) |
| Data for all four bodies, as Hermes bytecode | 300 KB or less (currently 260 KB) |
| Loading | An app only loads the bodies it shows. |
| Smoothness | Colour transitions, glow, zoom and pan run on the UI thread at the display's frame rate, with no React re-render per frame. |
| Lists | The small feed-card map must be cheap enough to show many times in a scrolling list. |

### Benchmarks

Measured with the example app as a release build on an iPhone 17 Pro simulator (iOS 26.5, 60 Hz) on an Apple-silicon Mac. A simulator on a fast Mac is much quicker than a phone, so read these as comparisons between approaches and as headroom, not as device numbers. Android has not been measured.

To rerun: `cd example && npx expo run:ios --configuration Release`, then `npm run bench`.

Set-up, male front body:

| Step | Median |
|---|---|
| Build the Skia paths for one level | 0.2 to 0.4 ms |
| Build the outline path | 0.06 ms |
| Resolve values for a level | 0.04 ms |
| Hit-test one tap | 0.002 ms |

Cost of drawing one frame at Full detail into a 966 by 2100 pixel surface. Each frame is one step of a blend between two workouts, so the number of glowing regions changes from frame to frame: between 0 and 16 of the 72, about 10 on average. Every figure includes one read-back of the surface, which is the same for every approach. The steady figures are taken after a warm-up over the whole blend, and are the median of ten runs; single runs varied by about 0.05 ms, with occasional outliers of up to 0.2 ms.

| Approach | No glow | Glow as one blurred layer | Glow as a blurred mask per region |
|---|---|---|---|
| Draw directly | 0.24 ms | 0.40 ms | 0.26 ms |
| Record a picture, then draw it | 0.24 ms | 0.41 ms | 0.29 ms |
| Draw an already recorded picture | 0.20 ms | 0.34 ms | 0.23 ms |

With all 70 muscle regions glowing steadily, the layer costs 0.52 ms and the masks cost 0.37 ms. So once warm, a mask per region is the cheaper glow by 0.1 to 0.15 ms a frame.

The first frame is different, because each region's mask has to be blurred the first time it glows. Time for the first frame of a case, recording a picture and drawing it:

| Glowing regions on the first frame | No glow | Glow as one blurred layer | Glow as a blurred mask per region |
|---|---|---|---|
| 16 | 4.2 ms | 4.8 ms | 13.4 ms |
| 70 | | 4.3 ms | 28.9 ms |

The 70-region row was measured drawing directly, not through a picture, and has no figure without glow. Recording a picture on its own costs about 0.04 ms on the JS thread and 0.2 to 0.6 ms on the UI thread during a live animation.

Live animation of every region's colour for six seconds, full screen:

| Approach | Frames slower than 1.5x the median | Memory, no glow | Memory, layer glow | Memory, mask glow |
|---|---|---|---|---|
| One Skia node per region | 0% | 59 MB | 61 MB | 66 MB |
| One picture re-recorded each frame | 0% | 57 MB | 59 MB | 63 MB |

Every case ran at the simulator's 60 frames a second with a median frame gap of 16.67 ms. Frame times here are the gaps between UI-thread frame callbacks. They show whether the UI thread kept up, not how long the GPU took, and a percentage measured against the median cannot show a rate that is slow on every frame.

An idle app with no canvas uses 45 MB.

Feed-card maps in a list:

| Approach | Prepare 20 | Mounted and drawn, 20 | Memory for 20 | Memory for 60 |
|---|---|---|---|---|
| A live canvas per card showing a recorded picture | 8 ms | 32 ms | 48 MB | 52 MB |
| A PNG rendered once, shown as a React Native image | 115 ms | 149 ms | 57 MB | 71 MB |

"Mounted and drawn" is the time from first render to the second frame after it; an empty screen takes the same 32 ms. The image approach keeps its PNGs as base64 strings in JS memory, which is part of its cost here.

These cases do not scroll. Scrolling is measured with the library's own component further down.

The harness keeps its offscreen surfaces for the life of the app and releases image snapshots by hand as soon as they are read. Leaving either to the garbage collector, or freeing a surface between cases, intermittently crashed inside Skia's GPU resource cache; with both changes the draw case ran ten times in a row without a crash. The library itself never creates offscreen surfaces or snapshots.

What the renderer does as a result:

- **One picture, re-recorded on the UI thread only while values are animating.** Neither approach dropped frames in the simulator, so this run does not separate them on speed. The picture used 2 to 3 MB less memory, and it needs one derived value where the other approach needs one per region.
- **Glow as a single blurred layer** holding only the regions above the glow threshold, skipped when nothing glows. This is a trade, not a clear win: the layer costs about 0.13 ms a frame more than a mask per region once warm. In return the first frame of a newly glowing set of regions costs about the same as a frame with no glow, where masks added 9 ms for 16 regions and about 25 ms for 70, on a Mac far faster than a phone. It also used 4 to 5 MB less memory. A steady small cost was chosen over a hitch whenever a different set of muscles lights up.
- **The feed-card map is a small canvas showing a picture recorded once.** Pre-rendering to an image took about 14 times longer to prepare and used 9 MB more memory for 20 cards.

The library's own components, measured the same way (four runs each). CPU is not recorded by the harness; it was read by hand with `top` on the app's process while each case ran.

| Case | Frames slower than 1.5x the median | Memory | Notes |
|---|---|---|---|
| One full map at Full detail, idle | 0% | 57 MB | About 1% CPU against 0% for an empty screen. The empty screen has no frame counter and this case's harness has one, so the map's share was not measured separately |
| The same map with its values changing every 400 ms | 0% | 59 MB | Glow on |
| 20 feed-card maps | 0% | 53 MB | |
| 60 feed-card maps | 0% | 55 to 56 MB | |
| 60 feed-card maps, scrolled back and forth | 0% | 55 to 60 MB | About 5% CPU while scrolling |

This harness adds about 4 MB of its own over the earlier feed-card cases, so a feed-card map costs roughly 0.1 MB. Feed-card maps with the same body and colours share one set of paints; that made no measurable difference to memory (53 and 55 to 56 MB before and after) and is kept because it creates fewer native objects.

The longest single frame gap while a screen mounted varied widely between runs of the same case, from 17 ms to 304 ms across twenty runs, with five of the twenty over 60 ms and no pattern by case. So mounting can drop frames, and how much is not pinned down. A virtualised list, which mounts only the visible cards, has not been measured.

The on-device tap self-test runs the hit test at every region's label point on the four bodies at all three levels: 600 of 600 found their own region. It calls the hit test directly and sends no real touches, so it does not show that a touch reaches the map.

Region ids are public API. Renaming or removing one is a breaking change and needs a major version.

## Rules

These apply to everyone working in this repo, people and AI agents alike.

### 1. Ask who you are working with

Before creating a branch or changing anything, ask the user for their name, unless they have already given it in this session. Do not guess it from git config, the machine or existing branches. Use their lowercase first name as `{user}` in branch names.

### 2. Understand a feature before building it

Do not write feature code until both steps are done.

1. **Ask questions** until the feature is fully understood. Do not assume. Cover the gaps the user may not have considered:
   - **Scope:** what is in this version, what is explicitly out, and which layer it belongs to (data, core or renderer).
   - **API:** what the consumer passes in and gets back, and whether it changes or breaks anything already public, including region ids.
   - **Data:** whether the pipeline or the data format changes, and whether all four bodies are affected.
   - **Performance:** which targets above it could affect, and how that will be measured.
   - **States and edge cases:** missing or partial values, values outside 0 to 1, left/right differences, non-muscle regions, very small and very large render sizes.
   - **Platforms:** iOS and Android differences, low-end devices, and whether a web renderer is in scope.
   - **Consumers:** what Momentum needs to change to adopt it, and whether older versions keep working.
2. **Summarise the agreed requirements** back to the user and get a go-ahead before starting.

### 3. Branches

- Never commit directly to `main`. Branch from an up-to-date `main` for every piece of work.
- Name branches `{user}/{type}/{short-name}`:
  - `{type}` is `feature` (new functionality), `bugfix` (fixing broken behaviour) or `chore` (docs, refactors, tooling, dependencies, clean-up).
  - `{short-name}` is kebab-case and descriptive. No dates, no vague names like `changes` or `fixes`.
  - Examples: `bevan/feature/skia-renderer`, `britto/bugfix/hit-test-overlap`, `thev/chore/update-readme`.
- One feature or fix per branch.
- Delete branches once they are merged.

### 4. Commits

- Small, focused commits that each leave the project building and its tests passing.
- Descriptive imperative messages, such as `Add weighted roll-up for muscle values`.
- Review `git status` and `git diff` before committing, and stage specific files, not everything.
- Commit or push only when the user asks.

### 5. Pull requests

- Everything reaches `main` through a pull request. No exceptions.
- When the user asks to commit and push finished work, open a pull request with a summary and a test plan, and give the user the link. The job ends there.
- Never bypass branch protection and never force-push to `main`.

### 6. Merging: review first, and only with the user's approval

Only the user can approve a merge. Approval covers that one pull request and does not carry over to the next.

When the user approves a merge, that starts a review; it is not an instant merge. Run the review as a background agent so the user is not blocked, and tell them it has started.

1. **Review.** The agent checks out the pull request and reviews its full diff against `main`, using the checklist below. It also traces how the changed code is used elsewhere, not only the lines in the diff.
2. **Fix.** If it finds real problems, it fixes them on a new branch off the pull request's branch, named `{user}/bugfix/<pr-short-name>-review-<n>`, and opens a fix pull request that targets the original pull request's branch, not `main`. The fix pull request lists each problem, why it is a problem, and the fix.
3. **Loop.** A fresh review pass then checks the whole diff again with the fix applied, because fixes can introduce new problems. Once that pass confirms the fix, the fix pull request is merged into the original branch. Repeat from step 1 until a pass finds nothing.
4. **Cap.** Stop after 3 rounds and ask the user for help. Also stop straight away, without merging, if a finding needs a product decision, changes the pull request's scope, or changes the public API or region ids.
5. **Merge.** Once a pass is clean, merge the pull request into `main`, delete its branch and the fix branches, and report to the user: rounds run, problems found and fixed (with links), and anything deliberately left alone.

Never report a clean review without having run it. If the review could not run, for example because the build or tests failed to start, say so and do not merge.

#### Review checklist

Every review covers all of these, not only correctness.

- **Correctness:** logic errors, crashes, regressions, broken types or imports. Type-check and tests must pass.
- **Speed:** nothing slow on the mount path, no work repeated that could be cached, and no avoidable per-frame allocation. The one picture recorded per animating frame is the measured design (see Benchmarks); an idle map must do no per-frame work at all.
- **Smoothness:** animation and gestures stay on the UI thread, with no React state updates per frame.
- **Memory and size:** the data budgets above still hold, bodies still load on demand, native objects are created once and reused.
- **Optimisation claims are measured:** any change made for performance comes with before and after numbers. No unmeasured optimisations.
- **Code quality:** clear names, focused files, no dead code, no duplicated logic, no stray debug logging, layers respected.
- **API and data:** public API and region ids unchanged unless the pull request says so, and generated data was regenerated, not edited by hand.
- **Repo hygiene:** the rules in the next section.

### 7. Keep the repo and file structure clean

- **Every file has one obvious home.** Follow the structure above. Do not add new top-level or `src/` folders without asking the user first.
- **Search before creating.** Extend an existing helper or component rather than duplicating it.
- **Keep files focused.** One main component or concern per file. Split a file that passes about 400 lines or mixes concerns.
- **Delete, don't orphan.** When something is replaced, remove the old code, assets and imports in the same change. No commented-out code and no `*Old` or `*V2` copies.
- **Never edit generated files by hand.** Change the pipeline or the generator and regenerate.
- **Never commit** secrets, build output, `node_modules`, `pipeline/vendor/`, `pipeline/out/`, Python caches, or scratch files, screenshots and one-off scripts.
- **No new dependencies without asking.** Runtime dependencies are not allowed at all; see Targets.
- **Keep this file up to date** when the structure, targets or rules change.

## Licence

To be decided. Whatever licence is chosen, the MuscleMap MIT notice must be included with the data.
