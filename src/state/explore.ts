/**
 * Explore navigation state (spec §7): the current folder, the selected
 * node, and the back-stack. Folder navigation resets the canvas caches
 * per node automatically (layouts are node-keyed on the Rust side).
 */
import { create } from "zustand";
import { invoke } from "../lib/ipc";

/** One "Focus" affordance pulse (session 13): the id + a fresh
 * timestamp; consumers (canvas + DOM modes) animate it so the action
 * is never a silent no-op. */
export interface FocusPulse {
  id: number;
  at: number;
}

export interface ExploreStore {
  /** The folder the Explore tab is currently showing (scan root = 0). */
  currentFolder: number;
  /** The selected node (single click; inspector + hover chip track it). */
  selectedNode: number | null;
  /** Back-stack of previously visited folders (for the top-bar back chevron). */
  folderStack: number[];
  /** The live focus pulse (rendered by every mode; cleared after the
   * animation window). */
  focusPulse: FocusPulse | null;
  openFolder: (id: number) => void;
  goBack: () => void;
  select: (id: number | null) => void;
  /** Focus an item (the inspector's Focus button, session 13 — the
   * dead-for-files bug fix): a folder drills in; a FILE navigates to
   * its parent, selects it and pulses it in every mode; an
   * already-focused folder says so instead of doing nothing. */
  focusItem: (id: number, opts: { isDir: boolean; path: string }) => Promise<void>;
  /** Reset navigation on a new scan (scan-done swap). */
  resetNavigation: () => void;
  /** Test seam: drop the pulse. */
  clearFocusPulse: () => void;
}

export const useExploreStore = create<ExploreStore>((set, get) => ({
  currentFolder: 0,
  selectedNode: null,
  folderStack: [],
  focusPulse: null,

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

  focusItem: async (id, { isDir, path }) => {
    if (isDir) {
      if (id === get().currentFolder) {
        // Already the view's subject — SAY so; a button that does
        // nothing on its most likely click is a defect (the owner's
        // report: "I clicked it multiple times nothing happens").
        window.dispatchEvent(
          new CustomEvent("db-toast", {
            detail: { text: "Already focused — this folder is the current view.", icon: "check" },
          }),
        );
        return;
      }
      get().openFolder(id);
      return;
    }
    // A file: bring its parent on screen, select it, and pulse it —
    // "where is this on my disk?" answered visually in every mode.
    const sep = path.lastIndexOf("\\");
    const slash = path.lastIndexOf("/");
    const cut = Math.max(sep, slash);
    if (cut > 0) {
      const parentPath = path.slice(0, cut);
      try {
        const status = await invoke<{ generation: number; scanning: boolean }>("get_status");
        if (!status.scanning) {
          const parentId = await invoke<number | null>("resolve_path", {
            generation: status.generation,
            path: parentPath,
          });
          if (parentId != null && parentId !== get().currentFolder) {
            get().openFolder(parentId);
          }
        }
      } catch {
        /* resolution is best-effort: selection + pulse still land */
      }
    }
    set(() => ({
      // openFolder cleared the selection; the file is the point —
      // re-select it (the canvas ring + inspector follow).
      selectedNode: id,
      focusPulse: { id, at: Date.now() },
    }));
  },

  resetNavigation: () => set({ currentFolder: 0, selectedNode: null, folderStack: [], focusPulse: null }),

  clearFocusPulse: () => set({ focusPulse: null }),
}));
