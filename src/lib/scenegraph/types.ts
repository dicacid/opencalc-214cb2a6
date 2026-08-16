/** Canonical scenegraph — the single source of truth shared by every
 *  environment (array calculator, stage tracing, mapping).
 *
 *  Coordinates are the acoustics engine's convention: metres, Z-up,
 *  +Y toward the audience. The renderer converts at the boundary
 *  (see src/lib/arraycalc/coords.ts). */

export type Vec3 = [number, number, number];

export interface SgVertex {
  id: string;
  p: Vec3;
}

export interface SgEdge {
  id: string;
  a: string; // vertex id
  b: string; // vertex id
}

/** A planar region. `loop` is the outer boundary in order; `holes` are
 *  inner loops (islands) that are respected by selection, triangulation,
 *  rendering and export — not treated as a visual mask. */
export interface SgFace {
  id: string;
  loop: string[];
  holes: string[][];
  name: string;
  material: string;
  /** unit normal, cached at commit time */
  n: Vec3;
}

export interface SgPhoto {
  /** object URL or data URL of the backdrop image */
  src: string;
  /** metres per pixel, from the two-point scale calibration */
  scale: number;
  /** image origin in world space */
  origin: Vec3;
  /** rotation of the image plane about Z, degrees */
  rot: number;
  opacity: number;
}

export interface Scenegraph {
  vertices: Record<string, SgVertex>;
  edges: Record<string, SgEdge>;
  faces: Record<string, SgFace>;
  photo: SgPhoto | null;
}

export type SgEntityKind = "vertex" | "edge" | "face";

export interface SgSelection {
  kind: SgEntityKind;
  id: string;
}

/** An immutable delta. Revisions are never destructive edits — the
 *  history is a list of these and any two can be diffed. */
export interface SgRevision {
  id: string;
  at: number;
  label: string;
  /** full snapshot; deltas are derived by diffing snapshots so a
   *  revision is always independently restorable */
  scene: Scenegraph;
}

export interface SgDiffEntry {
  kind: SgEntityKind;
  id: string;
  change: "added" | "removed" | "moved" | "changed";
  /** metres, for moved vertices */
  distance?: number;
  detail?: string;
}
