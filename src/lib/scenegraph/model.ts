import type { Scenegraph, SgFace, Vec3 } from "./types";

export const WELD_TOL = 1e-3; // 1 mm

let seq = 0;
export function sgId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyScene(): Scenegraph {
  return { vertices: {}, edges: {}, faces: {}, photo: null };
}

export function cloneScene(s: Scenegraph): Scenegraph {
  return JSON.parse(JSON.stringify(s)) as Scenegraph;
}

/* ---------------- vector helpers ---------------- */
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));

/** Orthonormal basis for a plane with the given normal. */
export function planeBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, n));
  const v = norm(cross(n, u));
  return { u, v };
}

/* ---------------- commit operations ----------------
   Every edit routes through these so welding, edge splitting,
   deduplication and face detection always run. */

/** Weld: return the id of an existing vertex within tolerance, else add one. */
export function addVertex(s: Scenegraph, p: Vec3, tol = WELD_TOL): string {
  for (const v of Object.values(s.vertices)) {
    if (dist(v.p, p) <= tol) return v.id;
  }
  const id = sgId("v");
  s.vertices[id] = { id, p };
  return id;
}

export function findEdge(s: Scenegraph, a: string, b: string): string | null {
  for (const e of Object.values(s.edges)) {
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.id;
  }
  return null;
}

/** Split any existing edge that the vertex lands on. */
export function splitEdgesAt(s: Scenegraph, vid: string, tol = WELD_TOL) {
  const p = s.vertices[vid]!.p;
  for (const e of Object.values({ ...s.edges })) {
    if (e.a === vid || e.b === vid) continue;
    const a = s.vertices[e.a]!.p;
    const b = s.vertices[e.b]!.p;
    const ab = sub(b, a);
    const L2 = dot(ab, ab);
    if (L2 < 1e-12) continue;
    const t = dot(sub(p, a), ab) / L2;
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    const proj = add(a, mul(ab, t));
    if (dist(proj, p) > tol) continue;
    delete s.edges[e.id];
    connect(s, e.a, vid, false);
    connect(s, vid, e.b, false);
  }
}

/** Add an edge, deduplicating and splitting where it crosses others. */
export function connect(s: Scenegraph, a: string, b: string, detect = true): string | null {
  if (a === b) return null;
  const existing = findEdge(s, a, b);
  let id = existing;
  if (!existing) {
    id = sgId("e");
    s.edges[id] = { id, a, b };
  }
  if (detect) {
    splitEdgesAt(s, a);
    splitEdgesAt(s, b);
    detectFaces(s);
  }
  return id;
}

/** Commit a polyline / polygon in world space. */
export function commitPath(s: Scenegraph, pts: Vec3[], close: boolean): string[] {
  const ids = pts.map((p) => addVertex(s, p));
  ids.forEach((id) => splitEdgesAt(s, id));
  for (let i = 0; i < ids.length - 1; i++) connect(s, ids[i]!, ids[i + 1]!, false);
  if (close && ids.length > 2) connect(s, ids[ids.length - 1]!, ids[0]!, false);
  detectFaces(s);
  return ids;
}

export function deleteEntity(s: Scenegraph, kind: string, id: string) {
  if (kind === "face") {
    delete s.faces[id];
    return;
  }
  if (kind === "edge") {
    delete s.edges[id];
    detectFaces(s);
    return;
  }
  if (kind === "vertex") {
    for (const e of Object.values({ ...s.edges })) {
      if (e.a === id || e.b === id) delete s.edges[e.id];
    }
    delete s.vertices[id];
    detectFaces(s);
  }
}

export function moveVertex(s: Scenegraph, id: string, p: Vec3) {
  const v = s.vertices[id];
  if (!v) return;
  v.p = p;
  detectFaces(s);
}

/* ---------------- face detection ----------------
   Group edges into coplanar sets, project each to 2D, walk minimal
   cycles, drop the outer cycle, and record containment as holes. */

function planeKey(n: Vec3, d: number) {
  const q = (x: number) => Math.round(x * 1000) / 1000;
  // canonical orientation so n and -n hash the same
  const s = n[0] + n[1] + n[2] < 0 ? -1 : 1;
  return [q(n[0] * s), q(n[1] * s), q(n[2] * s), q(d * s)].join(",");
}

function polyArea2(pts: Array<[number, number]>) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPoly2(pt: [number, number], poly: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rebuild every face from the current edge set, preserving name and
 *  material of any face with the same vertex loop. */
export function detectFaces(s: Scenegraph) {
  const prev = Object.values(s.faces);
  const found: SgFace[] = [];

  // group edges into candidate planes: for now every triple of connected
  // edges defines a plane; we bucket by the plane of each connected component
  const comps = connectedComponents(s);
  for (const comp of comps) {
    const pts = comp.map((v) => s.vertices[v]!.p);
    if (pts.length < 3) continue;
    const n = fitNormal(pts);
    if (!n) continue;
    const d = dot(n, pts[0]!);
    if (pts.some((p) => Math.abs(dot(n, p) - d) > 1e-2)) continue; // not coplanar
    const { u, v } = planeBasis(n);
    const to2 = (p: Vec3): [number, number] => [dot(p, u), dot(p, v)];
    const loops = minimalCycles(s, comp, to2);
    if (!loops.length) continue;

    const withArea = loops
      .map((loop) => ({ loop, area: Math.abs(polyArea2(loop.map((id) => to2(s.vertices[id]!.p)))) }))
      .sort((a, b) => b.area - a.area);

    // containment → holes
    const used = new Set<number>();
    withArea.forEach((outer, i) => {
      if (used.has(i)) return;
      const holes: string[][] = [];
      withArea.forEach((inner, j) => {
        if (j <= i || used.has(j)) return;
        const p0 = to2(s.vertices[inner.loop[0]!]!.p);
        if (pointInPoly2(p0, outer.loop.map((id) => to2(s.vertices[id]!.p)))) {
          holes.push(inner.loop);
          // the island still gets its own face
        }
      });
      found.push({
        id: sgId("f"),
        loop: outer.loop,
        holes,
        name: "",
        material: "surface",
        n,
      });
      if (holes.length) {
        for (const h of holes) {
          found.push({ id: sgId("f"), loop: h, holes: [], name: "", material: "surface", n });
        }
      }
      used.add(i);
    });
  }

  // carry over names/materials by loop identity
  const key = (loop: string[]) => [...loop].sort().join("|");
  const byKey = new Map(prev.map((f) => [key(f.loop), f]));
  s.faces = {};
  for (const f of found) {
    const old = byKey.get(key(f.loop));
    if (old) {
      f.id = old.id;
      f.name = old.name;
      f.material = old.material;
    }
    s.faces[f.id] = f;
  }
}

function connectedComponents(s: Scenegraph): string[][] {
  const adj = adjacency(s);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of Object.keys(adj)) {
    if (seen.has(id)) continue;
    const stack = [id];
    const comp: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of adj[cur] ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

export function adjacency(s: Scenegraph): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const e of Object.values(s.edges)) {
    (adj[e.a] ??= []).push(e.b);
    (adj[e.b] ??= []).push(e.a);
  }
  return adj;
}

function fitNormal(pts: Vec3[]): Vec3 | null {
  // Newell's method
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const n: Vec3 = [nx, ny, nz];
  if (len(n) < 1e-9) {
    // degenerate (collinear); try a spanning cross product
    for (let i = 2; i < pts.length; i++) {
      const c = cross(sub(pts[1]!, pts[0]!), sub(pts[i]!, pts[0]!));
      if (len(c) > 1e-9) return norm(c);
    }
    return null;
  }
  return norm(n);
}

/** Planar minimal-cycle walk: always take the most clockwise turn. */
function minimalCycles(
  s: Scenegraph,
  comp: string[],
  to2: (p: Vec3) => [number, number],
): string[][] {
  const inComp = new Set(comp);
  const adj = adjacency(s);
  const halfSeen = new Set<string>();
  const cycles: string[][] = [];
  const ang = (from: string, to: string) => {
    const a = to2(s.vertices[from]!.p);
    const b = to2(s.vertices[to]!.p);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  for (const start of comp) {
    for (const first of adj[start] ?? []) {
      if (!inComp.has(first)) continue;
      if (halfSeen.has(`${start}>${first}`)) continue;
      const loop: string[] = [start];
      let prev = start;
      let cur = first;
      let guard = 0;
      let ok = true;
      while (guard++ < 512) {
        halfSeen.add(`${prev}>${cur}`);
        if (cur === start) break;
        loop.push(cur);
        const back = ang(cur, prev);
        let best: string | null = null;
        let bestTurn = Infinity;
        for (const nb of adj[cur] ?? []) {
          if (nb === prev && (adj[cur]?.length ?? 0) > 1) continue;
          let turn = back - ang(cur, nb);
          while (turn <= 0) turn += Math.PI * 2;
          while (turn > Math.PI * 2) turn -= Math.PI * 2;
          if (turn < bestTurn) {
            bestTurn = turn;
            best = nb;
          }
        }
        if (!best) {
          ok = false;
          break;
        }
        prev = cur;
        cur = best;
      }
      if (!ok || loop.length < 3) continue;
      const area = polyArea2(loop.map((id) => to2(s.vertices[id]!.p)));
      if (area <= 1e-6) continue; // outer face / degenerate
      cycles.push(loop);
    }
  }
  // dedupe by vertex set
  const seen = new Set<string>();
  return cycles.filter((c) => {
    const k = [...c].sort().join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------- triangulation (holes respected) ---------------- */

/** Ear-clipping on the 2D projection, with holes bridged into the outer
 *  loop. Returns world-space triangles. */
export function triangulateFace(s: Scenegraph, f: SgFace): Vec3[] {
  const { u, v } = planeBasis(f.n);
  const to2 = (p: Vec3): [number, number] => [dot(p, u), dot(p, v)];
  let poly = f.loop.map((id) => ({ id, p: s.vertices[id]!.p, q: to2(s.vertices[id]!.p) }));
  if (polyArea2(poly.map((x) => x.q)) < 0) poly.reverse();

  for (const hole of f.holes) {
    let h = hole.map((id) => ({ id, p: s.vertices[id]!.p, q: to2(s.vertices[id]!.p) }));
    if (polyArea2(h.map((x) => x.q)) > 0) h.reverse();
    // bridge the hole's rightmost vertex to the nearest outer vertex
    let hi = 0;
    h.forEach((x, i) => {
      if (x.q[0] > h[hi]!.q[0]) hi = i;
    });
    let oi = 0;
    let bestD = Infinity;
    poly.forEach((x, i) => {
      const d = (x.q[0] - h[hi]!.q[0]) ** 2 + (x.q[1] - h[hi]!.q[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        oi = i;
      }
    });
    const rotated = [...h.slice(hi), ...h.slice(0, hi)];
    poly = [
      ...poly.slice(0, oi + 1),
      ...rotated,
      rotated[0]!,
      ...poly.slice(oi),
    ];
  }

  const tris: Vec3[] = [];
  const idx = poly.map((_, i) => i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 4096) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = poly[idx[(i + idx.length - 1) % idx.length]!]!;
      const b = poly[idx[i]!]!;
      const c = poly[idx[(i + 1) % idx.length]!]!;
      const cr = (b.q[0] - a.q[0]) * (c.q[1] - a.q[1]) - (b.q[1] - a.q[1]) * (c.q[0] - a.q[0]);
      if (cr <= 0) continue;
      let contains = false;
      for (let j = 0; j < idx.length; j++) {
        if (j === i || j === (i + 1) % idx.length || j === (i + idx.length - 1) % idx.length) continue;
        if (pointInPoly2(poly[idx[j]!]!.q, [a.q, b.q, c.q])) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push(a.p, b.p, c.p);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    tris.push(poly[idx[0]!]!.p, poly[idx[1]!]!.p, poly[idx[2]!]!.p);
  }
  return tris;
}

/** Ray/face hit test that lets the ray pass through hole loops. */
export function rayFace(
  s: Scenegraph,
  f: SgFace,
  origin: Vec3,
  dir: Vec3,
): { t: number; p: Vec3 } | null {
  const denom = dot(f.n, dir);
  if (Math.abs(denom) < 1e-9) return null;
  const p0 = s.vertices[f.loop[0]!]!.p;
  const t = dot(sub(p0, origin), f.n) / denom;
  if (t <= 0) return null;
  const p = add(origin, mul(dir, t));
  const { u, v } = planeBasis(f.n);
  const to2 = (q: Vec3): [number, number] => [dot(q, u), dot(q, v)];
  const q = to2(p);
  if (!pointInPoly2(q, f.loop.map((id) => to2(s.vertices[id]!.p)))) return null;
  for (const hole of f.holes) {
    if (pointInPoly2(q, hole.map((id) => to2(s.vertices[id]!.p)))) return null; // ray passes through
  }
  return { t, p };
}

export function faceArea(s: Scenegraph, f: SgFace): number {
  const { u, v } = planeBasis(f.n);
  const to2 = (p: Vec3): [number, number] => [dot(p, u), dot(p, v)];
  let a = Math.abs(polyArea2(f.loop.map((id) => to2(s.vertices[id]!.p))));
  for (const h of f.holes) a -= Math.abs(polyArea2(h.map((id) => to2(s.vertices[id]!.p))));
  return Math.max(0, a);
}
