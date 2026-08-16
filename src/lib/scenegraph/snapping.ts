import type { Scenegraph, Vec3 } from "./types";
import { add, cross, dot, len, mul, norm, planeBasis, rayFace, sub } from "./model";

/** Deterministic, SketchUp-style inference snapping.
 *
 *  Candidates are ranked by a fixed priority, and precision is evaluated
 *  in SCREEN space, so an endpoint is equally easy to acquire at 1 m or
 *  1 km from the camera. */
export const SNAP_PRIORITY = [
  "endpoint",
  "midpoint",
  "intersection",
  "on-edge",
  "axis",
  "on-face",
] as const;

export type SnapKind = (typeof SNAP_PRIORITY)[number];

export interface SnapResult {
  kind: SnapKind;
  p: Vec3;
  /** pixels from the cursor */
  px: number;
  /** entity that produced the snap, if any */
  ref?: string;
}

export interface SnapContext {
  scene: Scenegraph;
  /** world → screen pixels */
  project: (p: Vec3) => [number, number] | null;
  cursor: [number, number];
  /** camera ray for face/plane hits */
  rayOrigin: Vec3;
  rayDir: Vec3;
  /** fallback construction plane (z = planeZ) */
  planeZ: number;
  /** pixel radius */
  tolerance?: number;
  /** last committed point, for parallel / perpendicular guides */
  anchor?: Vec3 | null;
}

const rank = (k: SnapKind) => SNAP_PRIORITY.indexOf(k);

export function snap(ctx: SnapContext): SnapResult {
  const tol = ctx.tolerance ?? 12;
  const { scene, project, cursor } = ctx;
  const out: SnapResult[] = [];

  const push = (kind: SnapKind, p: Vec3, ref?: string) => {
    const q = project(p);
    if (!q) return;
    const px = Math.hypot(q[0] - cursor[0], q[1] - cursor[1]);
    if (px <= tol) out.push(ref === undefined ? { kind, p, px } : { kind, p, px, ref });
  };

  // 1 endpoints
  for (const v of Object.values(scene.vertices)) push("endpoint", v.p, v.id);

  // 2 midpoints
  for (const e of Object.values(scene.edges)) {
    const a = scene.vertices[e.a]?.p;
    const b = scene.vertices[e.b]?.p;
    if (!a || !b) continue;
    push("midpoint", mul(add(a, b), 0.5), e.id);
  }

  // 3 intersections of non-parallel edges
  const edges = Object.values(scene.edges);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const p = segIntersect(scene, edges[i]!.a, edges[i]!.b, edges[j]!.a, edges[j]!.b);
      if (p) push("intersection", p, `${edges[i]!.id}+${edges[j]!.id}`);
    }
  }

  // 4 points on edges (closest point along the segment to the cursor ray)
  for (const e of edges) {
    const a = scene.vertices[e.a]?.p;
    const b = scene.vertices[e.b]?.p;
    if (!a || !b) continue;
    const p = closestOnSegmentToRay(a, b, ctx.rayOrigin, ctx.rayDir);
    if (p) push("on-edge", p, e.id);
  }

  // 5 parallel / perpendicular guides from the anchor
  if (ctx.anchor) {
    const base = ctx.anchor;
    const hit = planeHit(ctx.rayOrigin, ctx.rayDir, ctx.planeZ);
    if (hit) {
      for (const e of edges) {
        const a = scene.vertices[e.a]?.p;
        const b = scene.vertices[e.b]?.p;
        if (!a || !b) continue;
        const d = norm(sub(b, a));
        for (const axis of [d, norm(cross(d, [0, 0, 1] as Vec3))]) {
          if (len(axis) < 1e-6) continue;
          const t = dot(sub(hit, base), axis);
          push("axis", add(base, mul(axis, t)), e.id);
        }
      }
      for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
        const t = dot(sub(hit, base), axis);
        push("axis", add(base, mul(axis, t)));
      }
    }
  }

  // 6 points on faces — coplanar with an existing surface, holes let the
  //   ray pass through to geometry behind
  for (const f of Object.values(scene.faces)) {
    const h = rayFace(scene, f, ctx.rayOrigin, ctx.rayDir);
    if (h) push("on-face", h.p, f.id);
  }

  out.sort((a, b) => rank(a.kind) - rank(b.kind) || a.px - b.px);
  if (out.length) return out[0]!;

  const free = planeHit(ctx.rayOrigin, ctx.rayDir, ctx.planeZ) ?? [0, 0, ctx.planeZ];
  return { kind: "on-face", p: free, px: Infinity };
}

export function planeHit(o: Vec3, d: Vec3, z: number): Vec3 | null {
  if (Math.abs(d[2]) < 1e-9) return null;
  const t = (z - o[2]) / d[2];
  if (t <= 0) return null;
  return add(o, mul(d, t));
}

function segIntersect(s: Scenegraph, a1: string, b1: string, a2: string, b2: string): Vec3 | null {
  const p1 = s.vertices[a1]?.p;
  const q1 = s.vertices[b1]?.p;
  const p2 = s.vertices[a2]?.p;
  const q2 = s.vertices[b2]?.p;
  if (!p1 || !q1 || !p2 || !q2) return null;
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const n = cross(d1, d2);
  const nl = len(n);
  if (nl < 1e-9) return null; // parallel
  const r = sub(p2, p1);
  if (Math.abs(dot(r, n)) / nl > 1e-3) return null; // skew
  const t = dot(cross(r, d2), n) / (nl * nl);
  const u = dot(cross(r, d1), n) / (nl * nl);
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return add(p1, mul(d1, t));
}

function closestOnSegmentToRay(a: Vec3, b: Vec3, o: Vec3, d: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  if (L2 < 1e-12) return null;
  const w0 = sub(a, o);
  const A = L2;
  const B = dot(ab, d);
  const C = dot(d, d);
  const D = dot(ab, w0);
  const E = dot(d, w0);
  const den = A * C - B * B;
  if (Math.abs(den) < 1e-12) return null;
  const t = (B * E - C * D) / den;
  const tc = Math.max(0, Math.min(1, t));
  return add(a, mul(ab, tc));
}

/** Screen-space projector built from a camera matrix pair. */
export function makeProjector(
  worldToClip: (p: Vec3) => [number, number, number, number],
  width: number,
  height: number,
) {
  return (p: Vec3): [number, number] | null => {
    const [x, y, , w] = worldToClip(p);
    if (w <= 0) return null;
    return [((x / w) * 0.5 + 0.5) * width, (-(y / w) * 0.5 + 0.5) * height];
  };
}

export { planeBasis };
