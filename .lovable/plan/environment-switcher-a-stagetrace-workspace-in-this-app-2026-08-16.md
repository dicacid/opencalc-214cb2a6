# Environment switcher + a StageTrace workspace in this app

Your architecture brief describes the mapping app as a Next.js / Prisma / Python-worker system at cadenceops.app/mapping. This project is a different stack — TanStack Start, server functions on Cloudflare Workers, Lovable Cloud Postgres — and no Python worker or long-running container can run here. So the plan below takes the brief's *design decisions* (which are the valuable part and are stack-neutral) and implements them natively, rather than porting its topology.

What carries over unchanged: the canonical scenegraph as the single source of truth, immutable revision deltas, screen-space inference snapping, deterministic export with a validation pass, and AS/NZS compliance tracking sitting beside the geometry. What changes: server functions replace the Node API routes, the CV pass runs through the AI gateway or in-browser WebGPU instead of an OpenCV worker fleet, and R3F is used directly rather than under Next.

## 1. The environment switcher

A workspace picker at the far left of the menu bar, before File — the desktop-suite pattern. It switches the main area between:

- **Array Calculator** — everything that exists today, unchanged.
- **StageTrace** — spatial tracing and the canonical scenegraph. Built in this pass.
- **Mapping** — projector placement, calibration, Resolume output. Entry present, disabled with a note, until StageTrace lands.

The existing tab strip stays and becomes scoped to the selected environment. One project, one venue scenegraph, one selection state shared across all three — the acoustic solver and the optical model reading the same geometry is the thing no tool in the brief's competitive set does.

## 2. StageTrace workspace

**Canonical scenegraph.** Typed vertex / edge / face model, serialised as JSON, persisted per project. Faces carry hole loops as first-class data — respected by selection, triangulation, rendering and export, not as a visual mask. All edits go through shared commit operations that weld coincident points, split edges at new vertices, dedupe edges, and run face detection over connected planar cycles after every commit.

**Screen-space inference snapping**, in the brief's priority order: endpoint, midpoint, intersection, point-on-edge, parallel/perpendicular guide, point-on-face. Thresholds in screen pixels, so an endpoint is equally acquirable at 1 m and 100 m. Face ray tests respect hole loops so the ray passes through openings to geometry behind.

**Tracing.** Upload a stage photo or plan, calibrate scale from two known points, trace surfaces over it with line / rectangle / polygon tools routed through the same commit path. Closed loops inside a face become islands with a recorded hole.

**Auto-segment.** One click proposes a mask per detected surface from the photo — server-function call through the AI gateway first, since that ships immediately and needs no worker fleet; in-browser SAM via ONNX Runtime Web on WebGPU as a later swap. Every proposal is editable and rejectable.

**Revisions and diff.** Edits stored as immutable deltas with bounded in-memory history. A revision diff view compares two revisions mathematically and highlights moved geometry — the "the stage shifted 4 cm since the CAD" case from the brief.

**Feeds the solver.** Traced surfaces extrude into the venue shell the acoustic engine already wants: reflective geometry and listening-plane context, no duplicate data model.

## 3. Rendering

One R3F workspace serving all three environments — same scene, same camera presets, same Cadence Ops conventions, different tool overlays per environment. Zustand holds tool, selection, hover and history so pointer movement never triggers a React render; the renderer watches model identity and updates only affected resources. Explicit geometry / material / texture disposal on unmount.

For the Array Calculator this replaces the current 2D-canvas `paint3d` painters: real cabinet boxes at true w×h×d, rigging with pick points and CoG, SPL-textured listening planes, ground grid and stage box, orbit/pan/zoom and click selection.

## 4. Compliance and export — scaffolded, not finished

- **Compliance:** an AS/NZS 3002:2021 / AS/NZS 3760 checklist attached to the project — RCD and test-and-tag logs with tester, test date and renewal date, plus overhead-clearance zones drawn in the 3D scene that flag when a planned tower or array violates them. This one genuinely belongs here, because rigging load limits already live in this app.
- **Export:** deterministic Truth Pack assembly — pure-TS compiler, identical input produces byte-identical output, aggressive overlap/gap/out-of-bounds validation before writing, ZIP containing the geometry plus an offline `viewer.html` findings report. GLTF/OBJ/JSON in this pass; Resolume Advanced Output XML, PIXERA, Disguise and Depence once the mapping environment exists.

## Technical notes

- Add `three`, `@react-three/fiber`, `@react-three/drei` at the Cadence Ops versions, plus `zustand` and a CSG library for Boolean face operations.
- New: `src/lib/scenegraph/` (model, commit ops, face detection, snapping, revisions), `src/components/workspace3d/`, `src/components/stagetrace/`, `src/lib/stagetrace/segment.functions.ts`, `src/lib/exports/` (truth pack), `src/lib/arraycalc/coords.ts` for the Z-up ↔ Y-up bridge.
- Scenegraph, revisions and compliance records persist to Lovable Cloud with RLS, alongside the existing cabinet library. Large artifacts go to storage, not the database.
- Views mount as React islands behind a client-only boundary; `src/lib/acoustics/*` maths is untouched and spot-checked identical before and after.

## Out of scope this pass

Neural projection mapping, projector auto-calibration, Gaussian splat ingestion, tdmcp/TouchDesigner orchestration, VLM advisory and capacity modelling. All are on the roadmap the brief sets out; none is buildable before the scenegraph exists.
