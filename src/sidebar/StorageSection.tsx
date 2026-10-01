/**
 * Sidebar §3 (spec §6.5): volume label + usage ring (conic gradient,
 * "xx.x% USED" center) + Total / Used (red) / Free (green) from
 * `disk_storage` (GetDiskFreeSpaceExW + GetVolumeInformationW on the
 * CURRENT VIEW's volume).
 *
 * Session 15 — the card follows the view: the probe is keyed on the
 * view-location store's `viewPath` (the single source of truth the
 * App resolver writes), so a C:↔D: flip inside the standing tree —
 * which changes neither `generation` nor `status` — now re-probes and
 * the card swaps to the new volume. The old [generation, status] deps
 * were the owner's report: "the disk is not changing on left sidebar".
 * While a new probe is in flight the PREVIOUS card stays (no blank
 * flash on flips); it clears only when the scan lifecycle leaves done.
 * The whole-PC view (path "This PC") gets the multi-root aggregate.
 */
import { useEffect, useState } from "react";
import { SectionCaption } from "../components/buttons";
import { invoke } from "../lib/ipc";
import { bytes } from "../lib/format";
import { useScanStore } from "../state/scan";
import { useExploreStore } from "../state/explore";

interface StorageInfo {
  label: string;
  total: number;
  used: number;
  free: number;
  usedPct: number;
}

export function StorageSection() {
  const generation = useScanStore((s) => s.generation);
  const status = useScanStore((s) => s.status);
  const viewPath = useExploreStore((s) => s.viewPath);
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    if (status !== "done") {
      setInfo(null);
      return;
    }
    // viewPath === "" right after a tree swap (resetNavigation cleared
    // it; the resolver is refetching) — skip the interim probe, the
    // real path lands within one round-trip.
    if (viewPath === "") return;
    let disposed = false;
    void (async () => {
      const res = await invoke<StorageInfo>("disk_storage", { path: viewPath }).catch(() => null);
      if (!disposed) setInfo(res);
    })();
    return () => {
      disposed = true;
    };
  }, [generation, status, viewPath]);

  if (!info) return null;
  const pct = Math.round(info.usedPct * 1000) / 10;

  return (
    <>
      <SectionCaption right={info.label}>Disk Storage</SectionCaption>
      <div className="db-storage">
        <div className="db-ring" style={{ ["--pct" as string]: pct }}>
          <strong>{pct}%</strong>
          <span>used</span>
        </div>
        <dl>
          <div>
            <dt>Total</dt>
            <dd className="tnum">{bytes(info.total)}</dd>
          </div>
          <div>
            <dt>Used</dt>
            <dd className="used tnum">{bytes(info.used)}</dd>
          </div>
          <div>
            <dt>Free</dt>
            <dd className="free tnum">{bytes(info.free)}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
