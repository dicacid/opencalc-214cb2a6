# Environment switcher + a Stage Tracing workspace grounded in the research

Two things in one pass: the drop-down you asked for, and the first real environment behind it — built from the technical signal in the StageTrace shortlist rather than from scratch.

## What the PDF is actually worth to us

The document is an outreach list, but the credibility notes describe, between them, a complete and public technique stack. Extracted and turned into build direction:

| Signal in the document | What we take from it |
| --- | --- |
| Rezwan's `segment-everything-td` — SAM 2/3 + YOLO11-seg auto-masking projection surfaces from a photo | Auto-trace is a solved primitive. Photo in, per-surface masks out. Runs in-browser via ONNX Runtime Web on WebGPU, or server-side through the AI gateway we already use for datasheet extraction. |
| Kurth — auto-calibration on *consumer* hardware by inverting a structured-light scan, single pass | The calibration maths to implement against, chosen for exactly our cost constraint. |
| Grundhöfer — ISMAR 2017 self-calibration, no human parameter tuning, 1 to 30 devices | The reliability bar and the multi-device generalisation. |
| Iwai + Grundhöfer — Eurographics STAR on projection mapping algorithms | The single survey to work from before writing any calibration code. |
| Iwai — neural projection mapping, joint geometric + defocus correction | The later upgrade path once the classical pass works. Not sprint one. |
| Heckaman's GSOPs — .ply/.spz Gaussian splats live at 60 fps | The venue-capture format. A splat or point-cloud import gives both the acoustic solver and the mapping view a real venue shell. |
| Watanabe — DynaFlash, 1000 fps deformable tracking | Scope boundary: static stages only. Moving sets are an order of magnitude harder and explicitly out. |
| van der Ploeg / Resolume, MadMapper, Disguise OmniCal | The interop targets. Resolume first — biggest touring install base. |
| VIOSO spun out of Bimber's group; Disguise ships OmniCal | Auto-alignment already ships commercially. Our differentiator is that acoustics and optics share one venue model — nobody in the list does both. |

All of it is published research and open-source work, so the same IP posture we took on the d&b physics holds: implement from the papers, clone no vendor's pipeline, use no vendor's naming.

The rankings, contact details and outreach strategy are go-to-market, not product — nothing to build from those. Worth keeping the file, though: the interop questions (what a Resolume handoff should look like, where segmentation breaks on real stage geometry) are exactly the ones the build will raise.

## 1. The environment switcher

A workspace picker at the far left of the menu bar, before File — the way a desktop suite selects document type. It switches the whole main area:

- **Array Calculator** — everything that exists today, unchanged.
- **Stage Tracing** — new, below.
- **Mapping** — projector placement and coverage. Stub in this pass, with the switcher entry present and disabled-with-a-note, so the shape is visible.

The existing tab strip (Venue / Arrays / 3D / …) stays, but becomes scoped to the selected environment. One project file, one venue model, one selection state across all three — that shared model is the whole point of putting them in one app.

## 2. Stage Tracing, first version

- Upload a stage photo or plan and place it as a calibrated backdrop (two known points set scale).
- Trace surfaces by hand — polygon tool, snapping, per-surface naming and material.
- **Auto-segment**: one click runs a segmentation pass over the photo and proposes a mask per detected surface; every proposal is editable and rejectable. Runs server-side first via a server function, so it works before any WebGPU work.
- Traced surfaces extrude into a 3D venue shell.
- That shell feeds the acoustic solver directly as reflective geometry and listening-plane context — the payoff for keeping one model.

Projector placement, structured-light calibration and Resolume export are deliberately not in this pass; they are the next environment.

## 3. The 3D workspace

The R3F workspace from the previous plan still gets built, and now serves all three environments instead of only the array view: same scene, same camera presets, same Cadence Ops conventions — different tool overlays per environment. Coordinate bridge, cabinet and rigging geometry, SPL-textured listening planes, orbit/pan/zoom and selection all as previously specified.

## Technical notes

- `three`, `@react-three/fiber`, `@react-three/drei` at the Cadence Ops versions.
- New: `src/components/array3d/` (scene, camera presets, meshes), `src/components/stagetrace/` (backdrop, trace canvas, surface list), `src/lib/stagetrace/` (surface model, extrusion, photo calibration), `src/lib/stagetrace/segment.functions.ts` (server-side segmentation), `src/lib/arraycalc/coords.ts`.
- Environment state lives in the existing imperative shell; the 3D and tracing views mount as React islands behind a client-only boundary.
- Traced surfaces persist with the project, and to the cloud alongside the cabinet library for signed-in users.
- No changes to `src/lib/acoustics/*` maths. SPL spot-check before and after confirms identical numbers.

## Out of scope

Moving sets and high-speed tracking, neural calibration, Gaussian splat capture, projector auto-calibration, and Resolume/MadMapper export — each earned a place on the roadmap from the document, none belongs in this pass.
