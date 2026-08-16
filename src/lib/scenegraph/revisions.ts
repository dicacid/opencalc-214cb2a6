import type { Scenegraph, SgDiffEntry, SgRevision } from "./types";
import { cloneScene, dist, sgId } from "./model";

export const MAX_HISTORY = 100;

export function pushRevision(history: SgRevision[], scene: Scenegraph, label: string): SgRevision[] {
  const rev: SgRevision = { id: sgId("r"), at: Date.now(), label, scene: cloneScene(scene) };
  const next = [...history, rev];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** Deterministic mathematical comparison of two revisions. */
export function diffScenes(a: Scenegraph, b: Scenegraph): SgDiffEntry[] {
  const out: SgDiffEntry[] = [];

  for (const id of Object.keys(a.vertices)) {
    const va = a.vertices[id]!;
    const vb = b.vertices[id];
    if (!vb) {
      out.push({ kind: "vertex", id, change: "removed" });
      continue;
    }
    const d = dist(va.p, vb.p);
    if (d > 1e-4) {
      out.push({
        kind: "vertex",
        id,
        change: "moved",
        distance: d,
        detail: `${(d * 1000).toFixed(0)} mm`,
      });
    }
  }
  for (const id of Object.keys(b.vertices)) {
    if (!a.vertices[id]) out.push({ kind: "vertex", id, change: "added" });
  }

  for (const id of Object.keys(a.edges)) {
    if (!b.edges[id]) out.push({ kind: "edge", id, change: "removed" });
  }
  for (const id of Object.keys(b.edges)) {
    if (!a.edges[id]) out.push({ kind: "edge", id, change: "added" });
  }

  const key = (loop: string[]) => [...loop].sort().join("|");
  const aFaces = new Map(Object.values(a.faces).map((f) => [key(f.loop), f]));
  const bFaces = new Map(Object.values(b.faces).map((f) => [key(f.loop), f]));
  for (const [k, f] of aFaces) {
    const other = bFaces.get(k);
    if (!other) {
      out.push({ kind: "face", id: f.id, change: "removed", detail: f.name || f.id });
    } else if (other.name !== f.name || other.material !== f.material || other.holes.length !== f.holes.length) {
      out.push({ kind: "face", id: f.id, change: "changed", detail: f.name || f.id });
    }
  }
  for (const [k, f] of bFaces) {
    if (!aFaces.has(k)) out.push({ kind: "face", id: f.id, change: "added", detail: f.name || f.id });
  }

  return out.sort((x, y) => (y.distance ?? 0) - (x.distance ?? 0));
}

export function summariseDiff(entries: SgDiffEntry[]) {
  const moved = entries.filter((e) => e.change === "moved");
  return {
    added: entries.filter((e) => e.change === "added").length,
    removed: entries.filter((e) => e.change === "removed").length,
    moved: moved.length,
    changed: entries.filter((e) => e.change === "changed").length,
    maxMove: moved.reduce((m, e) => Math.max(m, e.distance ?? 0), 0),
  };
}
