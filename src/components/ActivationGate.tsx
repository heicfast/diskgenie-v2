/**
 * The in-tab Activation Gate (docs/LICENSING-ARCHITECTURE.md §7):
 * rendered instead of Explore / Duplicates / Applications / Snapshots
 * while unlicensed or degraded. The Monitor tab stays live (owner
 * decision). Every locked surface funnels to the same two actions —
 * Activate (opens the dialog) and Purchase Licence.
 */
import { CheckIcon, LockKeyholeIcon, SparklesIcon } from "./Icon";
import { useLicenseStore } from "../state/license";
import { invoke } from "../lib/ipc";
import { track, EVENTS } from "../lib/analytics";
import type { TabId } from "../state/view";

const PITCH: Record<TabId, { title: string; lines: string[] }> = {
  explore: {
    title: "Explore every byte of your disk",
    lines: [
      "Full-disk map in 9 visual modes",
      "Quick Wins — the biggest safe space savings",
      "Inspector, previews, and one-click cleanup",
    ],
  },
  duplicates: {
    title: "Find and clear duplicate files",
    lines: [
      "Content-hash scan (bit-identical only)",
      "Hardlink-aware — never a false positive",
      "One-click review and cleanup",
    ],
  },
  applications: {
    title: "Uninstall apps completely",
    lines: [
      "Every installed app, Store and classic",
      "Leftover detection after uninstall",
      "Safe removal with your confirmation",
    ],
  },
  monitor: { title: "", lines: [] },
  snapshots: {
    title: "Track what changed over time",
    lines: [
      "Point-in-time disk snapshots",
      "Diff two snapshots — what grew, what shrank",
      "Keep your cleanup honest",
    ],
  },
};

export function ActivationGate({ tab }: { tab: TabId }) {
  const status = useLicenseStore((s) => s.status);
  const purchaseUrl = status?.purchaseUrl || "https://diskbytes.app/pricing";
  const posture = status?.posture ?? "unlicensed";
  const pitch = PITCH[tab] ?? PITCH.explore;

  const openPurchase = () => {
    track(EVENTS.checkoutOpened, { source: "activation-gate" });
    void invoke("open_url", { url: purchaseUrl }).catch(() => undefined);
  };

  const openDialog = () => {
    window.dispatchEvent(new CustomEvent("db-open-license"));
  };

  return (
    <div className="db-activation-gate" role="note" aria-label="Activation required">
      <div className="db-activation-gate-card">
        <div className="db-activation-gate-icon">
          {posture === "degraded" ? <LockKeyholeIcon size={22} /> : <SparklesIcon size={22} />}
        </div>
        <h2>
          {posture === "degraded"
            ? "Pro features are paused"
            : pitch.title}
        </h2>
        {posture === "degraded" ? (
          <p>
            DiskBytes couldn't verify your license for over 14 days. Reconnect
            and validate from the License panel to pick up exactly where you
            left off.
          </p>
        ) : (
          <>
            <ul>
              {pitch.lines.map((line) => (
                <li key={line}>
                  <CheckIcon size={13} />
                  {line}
                </li>
              ))}
            </ul>
            <p className="db-activation-gate-sub">
              One licence covers one Windows PC and one Mac.
            </p>
          </>
        )}
        <div className="db-activation-gate-actions">
          <button type="button" className="db-ink-button" onClick={openDialog}>
            <LockKeyholeIcon size={14} />
            {posture === "degraded" ? "Reactivate" : "Activate DiskBytes"}
          </button>
          {posture !== "degraded" && (
            <button type="button" className="db-outline" onClick={openPurchase}>
              Purchase Licence
            </button>
          )}
        </div>
        <p className="db-activation-gate-monitor">
          The <strong>Monitor</strong> tab stays live — always.
        </p>
      </div>
    </div>
  );
}
