# A real 3D modelling workspace for the array planner

You're right — I built both of the existing 3D environments on Cadence Ops. I pulled a read-only snapshot of that project and checked them, so this plan matches those conventions instead of inventing a third dialect:

- **Stage layout editor** (`src/components/stages/editor/`) — R3F `Canvas`, `OrbitControls`, drei `Grid`, `ShapeMesh` per object, pointer-down selection with shift-additive multi-select, drag-move with grid/deck/truss snapping, `camera-presets.ts` (front of house, stage left/right, backstage, top-down ortho, audience eye), object inspector + outliner + warnings panel.
- **Mapping viewer** (`src/components/mapping/MappingViewer.tsx`) — read-only viewer reusing `ShapeMesh`, perspective camera framed from the ground span, ACES tone mapping, fog, hemisphere + directional rig.
- Stack there: `three ^0.185`, `@react-three/fiber ^9`, `@react-three/drei ^10`. Y-up, metres, +Z toward the audience, +X stage right.

## What's actually in this app today

The "3D plot" is not a 3D environment. `paint3d`/`paintVenue3d` in `src/lib/arraycalc/app.ts` are 2D-canvas painters using an orthographic `proj3(az, el)` with a painter's-algorithm quad sort. There's no perspective, no zoom, no pan, no picking, no cabinet geometry (arrays draw as a 6 px square), no rigging, no venue shell. Drag only changes two angles.

## The change

Replace those two painters with one real R3F workspace, built to the Cadence Ops conventions above so the three environments feel like one product.

### 1. Coordinate bridge

The acoustics engine is Z-up with +Y toward the audience; Cadence Ops 3D is Y-up with +Z toward the audience. One small adapter module converts both ways (`three = [acX, acZ, acY]`), used everywhere, so `src/lib/acoustics/*` stays untouched and keeps producing identical numbers.

### 2. Real geometry in the scene

Everything the solver already computes gets drawn as actual 3D objects:

- **Cabinets** — one box per frame from `buildSource`, at true `w × h × d` from the cabinet spec, positioned and rotated by the frame's splay/tilt/azimuth. Tops, subs and muted boxes are visually distinct.
- **Rigging** — bumper bar, the two pick-point lines up to a motor marker, CoG marker, and a red state when `rigging()` reports over-limit or an illegal splay.
- **Listening planes** — real quads at their rake, with the SPL map painted onto them as a `DataTexture` from `mapPlane` values (same colour ramp as now), plus a wireframe when uncalculated.
- **Venue context** — ground grid sized to the site, stage box, FOH marker at the reference point.
- **Coverage** — optional translucent cone/fan per array showing nominal H/V coverage from the cabinet spec.

### 3. Interaction

- Orbit / pan / zoom via `OrbitControls`, with the same clamps as the mapping viewer.
- Camera presets reusing the Cadence Ops preset names and framing maths: front of house, stage left/right, top-down (ortho), audience eye height, frame-all.
- Click to select an array, a plane, or a single cabinet; selection highlights and drives the existing side panels. Shift-click additive, click-empty clears — same rules as the stage editor.
- Drag a selected array or plane on the ground plane to reposition, with grid snap; the numeric fields update live and the solver map invalidates.
- Gizmo-free rotate: drag with a modifier rotates azimuth in whole degrees.
- Layer toggles (cabinets / rigging / planes / SPL / coverage / grid) and a small legend, matching the mapping viewer's control strip.

### 4. How it plugs into the existing shell

The app shell is imperative DOM (`app.ts`). The 3D view becomes a React island mounted into the `plot3d` tab's plot frame, with a thin bridge: the shell hands it the current sources/planes/env/selection and receives change and selection callbacks. The rest of the shell keeps working unchanged, and the venue tab's small wireframe is replaced by the same component in a read-only mode.

`compute3d` keeps running the solver off the main thread path it uses today; the scene reads `cache.map` and re-textures the planes rather than recomputing.

## Technical notes

- Add `three`, `@react-three/fiber`, `@react-three/drei` at the same major versions as Cadence Ops.
- New files: `src/components/array3d/` (`Workspace3D.tsx`, `CabinetMesh.tsx`, `PlaneMesh.tsx`, `RiggingMesh.tsx`, `CoverageCone.tsx`, `camera-presets.ts`), `src/lib/arraycalc/coords.ts`, and a mount helper in `app.ts`.
- SSR safety: the workspace is loaded lazily behind a client-only boundary; the acoustics modules stay SSR-safe.
- No changes to `src/lib/acoustics/*` maths. A before/after SPL spot-check on the demo project confirms numbers are identical.

## Out of scope here

Importing a Cadence Ops stage layout as the venue shell, VBO-level GPU SPL evaluation, and shared cross-app project storage — each worth doing, but after this workspace exists.
