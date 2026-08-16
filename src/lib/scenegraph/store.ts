import { create } from "zustand";
import type { Scenegraph, SgPhoto, SgRevision, SgSelection, Vec3 } from "./types";
import { cloneScene, commitPath, deleteEntity, emptyScene, moveVertex } from "./model";
import { pushRevision } from "./revisions";

export type ToolId = "select" | "line" | "rect" | "polygon" | "move";

export interface SgState {
  scene: Scenegraph;
  /** bumped whenever geometry changes, so the renderer can watch model
   *  identity instead of re-rendering React on pointer movement */
  version: number;
  tool: ToolId;
  selection: SgSelection[];
  hover: SgSelection | null;
  draft: Vec3[];
  history: SgRevision[];
  historyIndex: number;
  planeZ: number;
  snapEnabled: boolean;

  setTool: (t: ToolId) => void;
  setHover: (h: SgSelection | null) => void;
  select: (s: SgSelection | null, additive?: boolean) => void;
  clearSelection: () => void;
  setPlaneZ: (z: number) => void;
  toggleSnap: () => void;

  pushDraft: (p: Vec3) => void;
  cancelDraft: () => void;
  commitDraft: (close: boolean) => void;

  nudgeVertex: (id: string, p: Vec3) => void;
  removeSelected: () => void;
  renameFace: (id: string, name: string) => void;
  setPhoto: (p: SgPhoto | null) => void;
  loadScene: (s: Scenegraph, label?: string) => void;
  commit: (label: string, fn: (s: Scenegraph) => void) => void;
  undo: () => void;
  redo: () => void;
  gotoRevision: (index: number) => void;
}

export const useSceneStore = create<SgState>((set, get) => ({
  scene: emptyScene(),
  version: 0,
  tool: "select",
  selection: [],
  hover: null,
  draft: [],
  history: [],
  historyIndex: -1,
  planeZ: 0,
  snapEnabled: true,

  setTool: (tool) => set({ tool, draft: [] }),
  setHover: (hover) => set({ hover }),
  select: (s, additive = false) =>
    set((st) => {
      if (!s) return { selection: [] };
      if (!additive) return { selection: [s] };
      const has = st.selection.some((x) => x.kind === s.kind && x.id === s.id);
      return {
        selection: has
          ? st.selection.filter((x) => !(x.kind === s.kind && x.id === s.id))
          : [...st.selection, s],
      };
    }),
  clearSelection: () => set({ selection: [] }),
  setPlaneZ: (planeZ) => set({ planeZ }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  pushDraft: (p) => set((s) => ({ draft: [...s.draft, p] })),
  cancelDraft: () => set({ draft: [] }),
  commitDraft: (close) => {
    const { draft } = get();
    if (draft.length < 2) return set({ draft: [] });
    get().commit(close ? "Closed loop" : "Path", (s) => commitPath(s, draft, close));
    set({ draft: [] });
  },

  nudgeVertex: (id, p) => get().commit("Move vertex", (s) => moveVertex(s, id, p)),
  removeSelected: () => {
    const sel = get().selection;
    if (!sel.length) return;
    get().commit("Delete", (s) => sel.forEach((x) => deleteEntity(s, x.kind, x.id)));
    set({ selection: [] });
  },
  renameFace: (id, name) =>
    get().commit("Rename surface", (s) => {
      const f = s.faces[id];
      if (f) f.name = name;
    }),
  setPhoto: (photo) =>
    get().commit(photo ? "Set backdrop" : "Clear backdrop", (s) => {
      s.photo = photo;
    }),
  loadScene: (scene, label = "Load") =>
    set((st) => ({
      scene: cloneScene(scene),
      version: st.version + 1,
      selection: [],
      draft: [],
      history: pushRevision([], scene, label),
      historyIndex: 0,
    })),

  commit: (label, fn) =>
    set((st) => {
      const next = cloneScene(st.scene);
      fn(next);
      const trimmed = st.history.slice(0, st.historyIndex + 1);
      const history = pushRevision(trimmed, next, label);
      return {
        scene: next,
        version: st.version + 1,
        history,
        historyIndex: history.length - 1,
      };
    }),

  undo: () => get().gotoRevision(get().historyIndex - 1),
  redo: () => get().gotoRevision(get().historyIndex + 1),
  gotoRevision: (index) =>
    set((st) => {
      if (index < 0 || index >= st.history.length) return {};
      return {
        scene: cloneScene(st.history[index]!.scene),
        version: st.version + 1,
        historyIndex: index,
        selection: [],
        draft: [],
      };
    }),
}));
