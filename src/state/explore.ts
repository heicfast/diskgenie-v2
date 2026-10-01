/**
 * Explore navigation state (spec §7): the current folder, the selected
 * node, and the back-stack. Folder navigation resets the canvas caches
 * per node automatically (layouts are node-keyed on the Rust side).
 *
 * Session 15 — the view-location single source of truth: `viewPath` /
 * `viewName` (the current folder's display path + name) live HERE, with
 * exactly ONE writer (the App-shell resolver that already fetches the
 * breadcrumb chain). Every "where is the view" consumer — the sidebar's
 * Disk Storage card, the drive chips' current marker, the Current View
 * section — derives from this instead of re-resolving it ad-hoc: the
 * drive-flip bug (the sidebar keeping the old volume after a C:↔D:
 * navigation) was exactly a consumer keying on the wrong lifecycle
 * ([generation, status] — neither changes on a navigation inside the
 * standing tree).
 */
import { create } from "zustand";

export interface ExploreStore {
  /** The folder the Explore tab is currently showing (scan root = 0). */
  currentFolder: number;
  /** The selected node (single click; inspector + hover chip track it). */
  selectedNode: number | null;
  /** Back-stack of previously visited folders (for the top-bar back chevron). */
  folderStack: number[];
  /** The current folder's display path ("" while unknown / scanning;
   *  the virtual whole-PC root carries its LABEL "This PC" — the same
   *  string node_details reports, and the disk-storage command's
   *  no-match marker that selects the multi-root aggregate). */
  viewPath: string;
  /** The current folder's display name (null while unknown). */
  viewName: string | null;
  openFolder: (id: number) => void;
  goBack: () => void;
  select: (id: number | null) => void;
  /** Reset navigation on a new scan (scan-done swap). Also clears the
   *  view location: node ids are tree-scoped, so the old path no
   *  longer describes the view. */
  resetNavigation: () => void;
}

export const useExploreStore = create<ExploreStore>((set, get) => ({
  currentFolder: 0,
  selectedNode: null,
  folderStack: [],
  viewPath: "",
  viewName: null,

  openFolder: (id) => {
    if (id === get().currentFolder) return;
    set((s) => ({
      folderStack: [...s.folderStack, s.currentFolder],
      currentFolder: id,
      selectedNode: null,
    }));
  },

  goBack: () => {
    const stack = get().folderStack;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    set((s) => ({
      folderStack: s.folderStack.slice(0, -1),
      currentFolder: prev,
      selectedNode: null,
    }));
  },

  select: (id) => set({ selectedNode: id }),

  resetNavigation: () =>
    set({ currentFolder: 0, selectedNode: null, folderStack: [], viewPath: "", viewName: null }),
}));
