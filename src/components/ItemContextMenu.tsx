/**
 * Item context menu (spec §7): Open / Preview / Show in Explorer /
 * Copy Path / Add to Cleanup — protected items disable stage with a
 * tooltip ("Windows manages this item"), cloud items refuse preview.
 * "Open" (session 14): folders drill in (the app's Open semantic);
 * files launch their default app (`open_node`) — same behavior as the
 * inspector's Open and the preview overlay, one consistent contract.
 */
import { useEffect, useRef, useState } from "react";
import { EyeIcon, FolderOpenIcon, CopyIcon, LockKeyholeIcon, PlusIcon, ExternalLinkIcon } from "./Icon";
import { REVEAL_NAME } from "../lib/platform";
import { useMenuBehavior } from "../lib/useMenuBehavior";

export interface ItemMenuState {
  id: number;
  x: number;
  y: number;
}

export interface ItemMenuTarget {
  id: number;
  name: string;
  isDir: boolean;
  isProtected: boolean;
  isCloud: boolean;
}

export interface ItemMenuActions {
  open: (id: number, isDir: boolean) => void;
  preview: (id: number) => void;
  reveal: (id: number) => void;
  copyPath: (id: number) => void;
  stage: (id: number) => void;
}

export function ItemContextMenu({
  target,
  actions,
  resolver,
  onClose,
}: {
  target: ItemMenuState | null;
  actions: ItemMenuActions;
  resolver: (id: number) => Promise<ItemMenuTarget | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<ItemMenuTarget | null>(null);

  useEffect(() => {
    if (!target) {
      setInfo(null);
      return;
    }
    setInfo(null);
    let disposed = false;
    void (async () => {
      const t = await resolver(target.id).catch(() => null);
      if (!disposed && t) setInfo(t);
    })();
    return () => {
      disposed = true;
    };
  }, [target, resolver]);

  // Keyboard model + outside-close + first-item focus (shared hook —
  // the behavior below used to live inline here only).
  useMenuBehavior(ref, target != null, onClose);

  if (!target) return null;

  const left = Math.min(target.x, window.innerWidth - 235);
  const top = Math.min(target.y, window.innerHeight - 210);

  return (
    <div ref={ref} className="db-context" style={{ left, top }} role="menu">
      <button type="button" role="menuitem" className="db-ctx-item" disabled={info?.isCloud} title={info?.isCloud ? "Cloud placeholders are never opened (that would download them)" : undefined} onClick={() => { actions.open(target.id, info?.isDir ?? true); onClose(); }}>
        <FolderOpenIcon size={14} /> Open
      </button>
      <button type="button" role="menuitem" className="db-ctx-item" disabled={info?.isCloud} title={info?.isCloud ? "Cloud placeholders are never previewed (that would download them)" : undefined} onClick={() => { actions.preview(target.id); onClose(); }}>
        <EyeIcon size={14} /> Preview
      </button>
      <button type="button" role="menuitem" className="db-ctx-item" onClick={() => { actions.reveal(target.id); onClose(); }}>
        <ExternalLinkIcon size={14} /> {REVEAL_NAME}
      </button>
      <button type="button" role="menuitem" className="db-ctx-item" onClick={() => { actions.copyPath(target.id); onClose(); }}>
        <CopyIcon size={14} /> Copy Path
      </button>
      <div className="db-ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="db-ctx-item"
        disabled={info?.isProtected}
        title={info?.isProtected ? "Windows manages this item" : undefined}
        onClick={() => { actions.stage(target.id); onClose(); }}
      >
        {info?.isProtected ? <LockKeyholeIcon size={14} /> : <PlusIcon size={14} />} Add to Cleanup
      </button>
    </div>
  );
}
