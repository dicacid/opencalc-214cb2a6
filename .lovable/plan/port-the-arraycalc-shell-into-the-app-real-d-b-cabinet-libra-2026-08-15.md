# Port the ArrayCalc shell into the app + real d&b cabinet library

Two things happen in this plan: the uploaded single-file tool becomes the actual app (running at `/`), and the placeholder cabinet table is replaced with real d&b entries (Y8, Y12, V-SUB, J-INFRA) plus a D80 amp model. Nothing proprietary is copied — only published datasheet figures, and the schema is prepared for user-supplied balloon data later.

## Part 1 — Port the tool into the project

The repo is still the blank template; the tool only exists as the uploaded HTML (both uploads are byte-identical). It gets moved in, not rewritten from scratch.

- Solver stays intact, moved verbatim into typed modules so behaviour cannot drift during the port:
  - `src/lib/acoustics/env.ts` — `aWeight`, `airAlpha`, `soundSpeed`
  - `src/lib/acoustics/cabinets.ts` — cabinet library + `maxSplAt`, `voicingGain`
  - `src/lib/acoustics/geometry.ts` — `buildSource`, `buildAll`, `segDir`, `horizDir`, `vertPointDir`
  - `src/lib/acoustics/solver.ts` — `refPressure`, `prepFrames`, `pressureAt`, plot/grid drivers
- UI becomes React components under `src/components/arraycalc/` (menubar, toolbar, panel + stepper field kit, tab strip, canvas plot frames, source/cabinet inspector), driven by React state instead of direct DOM writes. Canvas rendering stays imperative inside a `<canvas>` ref — no rewrite of the drawing code.
- The dark d&b-style theme moves into `src/styles.css` as semantic tokens (`--panel`, `--field`, `--ink`, `--plot`, etc. mapped through `@theme inline`), so components use tokens rather than hardcoded hex.
- `src/routes/index.tsx` replaces the placeholder and renders the tool full-viewport, with its own head metadata (title/description/og/twitter).
- Port is verified by diffing SPL output: the same rig and receiver points must produce identical numbers before and after the move.

## Part 2 — Real d&b cabinet library (Sprint 1)

`CABINETS` is replaced with a widened schema and d&b entries populated from published datasheets/manuals. Values that come from public documents are marked with a `source` field; anything I cannot confirm from a public document is marked `estimated: true` and shown as such in the UI rather than passed off as spec.

New per-cabinet fields on top of what exists today:

- `family`, `amp` (`'D80'`), `ampCh` (amp channels consumed per box)
- `splayMin` / `splayMax`, `qtyMax`, `rigFrame`, `mounting` (`flown` / `stacked` / `stack-only`)
- `lowCut` / `hiCut`, `maxSplOct` per octave band
- `voicing` — generic equivalents of the shelving curves already implemented in `voicingGain`, named neutrally (low-cut / coupling / HF comp), never with d&b's trademarked labels
- `balloons: null` — placeholder slot so the later GLL/`.gsd` importer plugs in without touching the solver signature

Entries added: **Y8** (80° H, 0–7° splay), **Y12** (120° H, 0–14° splay), **V-SUB** (cardioid, stack), **J-INFRA** (ground-stack only, 27–80 Hz). Existing generic boxes are kept in a separate "Generic" group so old rigs still load.

Constraints enforced in `buildSource` and surfaced in the UI:

- splay outside `splayMin..splayMax` → red field, blocks export
- box count above `qtyMax` → warning tile
- J-INFRA cannot be placed in a flown array (hard block)
- V-SUB / J-INFRA rejected inside a flown top array

## Part 3 — D80 amp model tile

A `D80` entry describes the amp as a resource budget, not a loudspeaker: 4 channels, 4 kΩ-mode power figures, three channel topologies (Dual Channel, 2-Way Active, Mix TOP/SUB) and a per-cabinet default mode. A live tile in the toolbar shows `boxes × channels / 4 = amps required`, updating as boxes are added.

## Disclaimer

An export footer and an About panel state the tool predicts free-field behaviour, is not a substitute for an approved rigging plan or an in-venue measurement sweep, and is not affiliated with or endorsed by d&b audiotechnik.

## Explicitly out of this plan

GLL/`.gsd` balloon import, ground reflection, ISO 9613-2 / NoizCalc grid, sub gradient presets, the generic box-FIR optimiser, and any AES70/OCA work — each is its own follow-up sprint. ArrayProcessing turn-on remains a permanent non-goal.

## Notes for later sprints

`pressureAt` keeps its current signature so the balloon lookup can be dropped in as a per-frame multiplier against `segDir`/`horizDir` without reshaping the pipeline.
