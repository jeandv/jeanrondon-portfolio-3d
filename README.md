# jean-portfolio-3d

3D portfolio "room" (React Three Fiber) inspired by felixrieseberg.com. The plan lives in [`docs/PLAN.md`](docs/PLAN.md); the Blender guide (Spanish, beginner friendly) in [`docs/BLENDER.md`](docs/BLENDER.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 (`?perf` shows r3f-perf, `?lite` forces the HTML-only site, `?nostill` shows the loader without the still) |
| `npm run build` | Asset manifest, typecheck, client build, SSR build of `src/seo/entry-server.tsx` and `scripts/prerender.mjs` (fills the `<!--head-->` / `<!--seo-->` slots of `dist/index.html` from `src/content`, writes `dist/sitemap.xml` and adds the `Sitemap:` line to `dist/robots.txt`) |
| `npm run typecheck` | `tsc -b --noEmit` (app, unit tests, e2e and config) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (`src/**/*.test.ts` only) |
| `npm run test:e2e` | Playwright smoke tests (`e2e/`) in the system Microsoft Edge against its own Vite dev server on port 5176 |
| `npm run greybox` | Regenerates `src/assets/models/room.glb` (greybox stand-in for the Blender export) and the asset manifest |
| `npm run assets` | `assets:glb` + `assets:textures` + `assets:manifest`: the Blender export and bakes into the app (see below) |
| `npm run assets:glb` | `blender/export/room.raw.glb` → `src/assets/models/room.glb` (`gltf-transform optimize` with the plan's flags, `inspect`, audit) |
| `npm run assets:textures` | `blender/bake/*.png` → `src/assets/bake/*.webp` (+ `_m` phone variants) with a size report |
| `npm run assets:manifest` | Writes `src/assets/sizes.json` (byte size of every asset under `src/assets`; the loader counts real bytes against it) |
| `npm run assets:fake-bake` | Synthetic bakes for the greybox in `blender/bake/` (pipeline test without Blender; undo with `node scripts/fake-bake.mjs --clean`) |
| `npm run capture:still` | Renders the home view in the system Microsoft Edge / Chrome (playwright-core, headless, 1920×1080) from its own Vite server on port 5174, and writes `public/still.jpg` (≤ 180 KB), `public/og.jpg` (1200×630) and `src/assets/still-calibration.json` (TV corners for the loader OSD). Re-run it whenever the room, the home framing or the TV title card changes |

## Loader, gate and audio

- `public/still.jpg` paints first (index.html preloads it) and is the LCP. The VCR OSD is laid onto its TV with a CSS `matrix3d` from the calibration. Without a still or calibration (first run, `?nostill`, data saver) the OSD runs in its "free" mode on a dark background. Once the room is live, the still and its `html.still` flag are removed.
- At 100% the OSD becomes the gate: CLICK TO ENTER (sound on) or ENTER MUTED. The click creates the AudioContext; the choice is kept in `localStorage`, and a second visit in the same tab session skips the gate.
- All sound is synthesised with Web Audio (`src/audio`): no audio files.

## Room details (phase 2A)

- **Desk lamp:** click it (no key binding). One shared `LAMP_MIX` (0 on, 1 off; `src/three/materials/lampMix.ts`) fades over 250 ms (cut with reduced motion) and drives the baked irradiance blend (`irrA` ↔ optional `irrB` lamp-off bake through `onBeforeCompile`; without `irrB` a group's `irrA` is scaled by 0.55), the greybox spot, the warm fill and the bulb (`lamp_bulb`, or a disc under `lamp_head`). The state lives in the store only; `?capture` keeps it on. A synthesized switch click plays.
- **Tape deck:** `#work/<id>` (notepad, keys or a click) sends that tape out of the rack, along an eased Bézier arc in front of the TV, flat into the VCR slot (the flap springs open, a thump); the TV shows INSERT TAPE until it clicks in, then a 150 ms static burst lands the tape channel. Another tape first ejects (soft click) and flies home; only one tape is ever off the shelf. Leaving #work keeps the tape in; #work without a tape ejects it. Pure state machine + path: `src/three/objects/tapes/{deck,path}.ts`.
- **Spine labels:** one 1024² canvas atlas (one row per slot) drawn from `src/content/work.ts` once the fonts are in: condensed Archivo title (auto-shrink, then ellipsis), VT323 years, label stock colour picked from the tape id, paper grain and worn edges. All labels are one batched mesh (one draw call); a Blender `tape_NN_label` plane replaces the auto decal.
- **TV light:** the TV canvas is sampled at 8×6 every 200 ms (and on channel changes), averaged in linear light and damped; it tints an additive glow card on the desk in front of the TV and, in greybox, a realtime spot. Blue INSERT TAPE throws a blue cast, a dark tape channel barely glows.
- **Adaptive quality:** drei `PerformanceMonitor` steps the DPR down the profile's range on sustained < 50 fps (the last tier also drops MSAA) and back up on recovery; after 3 direction flips it settles on the lower tier. Never in `?capture`.

## Blender → web asset pipeline (M3)

Step by step in [`docs/BLENDER.md`](docs/BLENDER.md). In short:

1. `blender/scripts/prep_bake.py` prepares one bake group at a time (custom property `bake`, UV maps `[UVMap, BakeUV]`, a `BAKE_TARGET` image node, Cycles settings) and can bake + save `blender/bake/<group>_<albedo|irrA>.png`.
2. `blender/scripts/export_prep.py`, on a `*_export.blend` copy, applies modifiers, joins the statics into `static_<group>`, sets one `M_<group>` material per baked object and validates the naming contract.
3. Export glTF to `blender/export/room.raw.glb`, then `npm run assets`.

`npm run assets:glb` runs `gltf-transform optimize` with the plan's flags plus `--prune false` (the plan's flags alone prune the `anchor_*` Empties), records the authored origin of `vcr_flap` as the `hinge` extra (meshopt quantization moves node origins; the flap spring rotates around it), and refuses to replace the GLB if a baked mesh lacks `TEXCOORD_1`, a baked mesh is instanced, a baked node has children, or the contract fails.

The app switches a bake group from greybox to baked materials as soon as both `src/assets/bake/<group>_albedo.webp` and `<group>_irrA.webp` exist. An optional `<group>_irrB.webp` (the same bake with the lamp off; `prep_bake.py --pass irrB`) is fetched after the room is live, outside the boot byte count (`sizes.json` lists it under `deferred`).

## Tests

- Unit: `npm test` (Vitest, node environment). Vitest only collects `src/**/*.test.ts`; `e2e/` is excluded.
- E2E: `npm run test:e2e`. Uses `@playwright/test` with `channel: 'msedge'` (the installed Microsoft Edge; no `playwright install`), one worker, and starts `vite --port 5176` with its own deps cache (`VITE_CACHE_DIR=node_modules/.vite-e2e`), so it never interferes with a dev server on :5173. The smoke suite covers: no console errors, the nav, loader → gate → ENTER MUTED → live canvas, hash → `body[data-route]`, the `#work/<tape>` deep link (ending with that tape in the VCR), clicking the lamp, `?lite`, and an unknown hash.
- Dev-only DOM signals (`src/state/devSignals.ts`): `body[data-lamp]` (on/off), `body[data-tape-state]` (empty/loading/playing/ejecting) and `body[data-vcr-tape]`.

## Performance (dev)

In dev, `window.__renderInfo()` (browser console or Playwright) returns the last composed frame's draw calls/triangles, one scene-only render, the post-processing share, `renderer.info` programs/textures/geometries, the EffectComposer passes, a material census (greybox vs baked, lightMap channel and intensity) and the adaptive `quality` tier (`{ tier, tiers, dpr, msaa, settled }`). `window.__screenPoint('<node>')` returns where a GLB node is drawn (CSS px), for scripted clicks. Budget (PLAN.md §7): ≤ 80 scene draw calls (cap 150), ≤ 300k triangles.

Greybox, home view, 1280×720, DPR 1: 31 scene draw calls / ~1k triangles (28 before phase 2A, + the label batch, the TV glow card and the lamp bulb), 17 post draw calls (RenderPass + one merged EffectPass: Lens, Bloom with its mip chain, Film, AgX). `#work` peaks at 35 scene calls (32 before).

### Lighthouse (needs a production build)

```bash
npm run build
npx vite preview          # http://localhost:4173
```

Then Chrome/Edge DevTools → Lighthouse → Desktop and Mobile (or `npx lighthouse http://localhost:4173 --view`). Targets: Desktop Perf ≥ 85, A11y ≥ 95, BP ≥ 95, SEO 100; Mobile Perf ≥ 65.

## Deploy (Cloudflare Pages)

- Connect the repo in Cloudflare Pages: **Build command** `npm run build`, **Build output directory** `dist`. Node 24 comes from `.nvmrc` (the Pages build image reads it; alternatively set the `NODE_VERSION=24` environment variable). Every branch gets a preview URL.
- `public/_headers`: `/assets/*` immutable for a year (hashed by Vite), `*.glb` as `model/gltf-binary`, `/` and `/index.html` `no-cache`, `still.jpg` / `og.jpg` cached for a day (stale-while-revalidate a week), plus `nosniff` and a referrer policy. Check with `curl -I https://<site>/`.
- `public/robots.txt` allows everything; the build appends `Sitemap: <SITE.url>/sitemap.xml` and writes `dist/sitemap.xml` from `src/content/site.ts`. While `SITE.url` is the `https://example.com` placeholder, the build prints a warning: set the real URL before launching.
- `public/favicon.svg` is linked from `index.html`.

## Known

- `THREE.Clock: This module has been deprecated` (console warning, three r183+): React Three Fiber 9 hard-codes `new THREE.Clock()` in its store and its frame loop drives `state.clock` (`getDelta()`, `elapsedTime`, `oldTime`; `VisibilityPause` relies on those too). R3F 9 has no option to pass a `THREE.Timer`, so the warning stays until an R3F release switches clocks. It is harmless.

Node 24 (`.nvmrc`).

# jeanrondon-portfolio-3d
