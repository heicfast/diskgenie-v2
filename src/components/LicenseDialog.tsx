/**
 * License dialog (docs/LICENSING-ARCHITECTURE.md §7): the activation
 * entry + the Pro status card. Owner decisions, session 10:
 *  * Until the COMPLETE key is in, the buttons are "Later" and
 *    "Purchase Licence" (no Dodo checkout, no free tier) — the primary
 *    becomes "Activate" only for a complete 22-char key.
 *  * On activation: a brief success state ("activated — thank you"),
 *    then the dialog closes itself.
 *  * Pro view: Status Active chip, name, email, Active until, and the
 *    thank-you line (the simulated variant is marked for CI).
 */
import { useEffect, useRef, useState } from "react";
import { CheckIcon, KeyIcon, LockKeyholeIcon, SparklesIcon } from "./Icon";
import { useLicenseStore } from "../state/license";
import { useFocusTrap } from "../lib/useFocusTrap";
import { isCompleteKey } from "../lib/licenseKey";
import { invoke } from "../lib/ipc";
import { track, EVENTS } from "../lib/analytics";

function activeUntilLabel(expiresAt: number, tier: string): string {
  if (tier === "lifetime" || expiresAt === 0) return "Lifetime";
  return new Date(expiresAt * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function LicenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useLicenseStore((s) => s.status);
  const activate = useLicenseStore((s) => s.activate);
  const deactivate = useLicenseStore((s) => s.deactivate);
  const validateNow = useLicenseStore((s) => s.validateNow);
  const busy = useLicenseStore((s) => s.busy);
  const error = useLicenseStore((s) => s.error);
  const activated = useLicenseStore((s) => s.activated);
  const consumeActivated = useLicenseStore((s) => s.consumeActivated);
  const [key, setKey] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Success → auto-close (premium: show the win, then leave quietly).
  useEffect(() => {
    if (!open || !activated) return;
    const t = window.setTimeout(() => {
      consumeActivated();
      onClose();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [open, activated, consumeActivated, onClose]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  // CI tour hook: a scripted key fill (captures the "Activate" button
  // state in the screenshots workflow).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string }>).detail;
      if (detail?.key) setKey(detail.key);
    };
    window.addEventListener("db-tour-license-key", onKey);
    return () => window.removeEventListener("db-tour-license-key", onKey);
  }, [open]);

  if (!open) return null;

  const posture = status?.posture ?? "unlicensed";
  const isPro = posture === "pro" || posture === "grace";
  const complete = isCompleteKey(key);
  const purchaseUrl = status?.purchaseUrl || "https://diskbytes.app/pricing";

  const openPurchase = () => {
    track(EVENTS.checkoutOpened, { source: "license-dialog" });
    void invoke("open_url", { url: purchaseUrl }).catch(() => undefined);
  };

  return (
    <div className="db-scrim" role="dialog" aria-modal="true" aria-label="License">
      <div className="db-dialog db-license-dialog" ref={dialogRef}>
        {activated ? (
          <>
            <h3>
              <CheckIcon size={16} /> DiskBytes Pro activated
            </h3>
            <div className="db-license-success">
              <div className="db-license-success-badge">
                <CheckIcon size={26} />
              </div>
              <p>
                Thank you for purchasing DiskBytes. Every tool is unlocked on
                this device — enjoy the clean disk.
              </p>
            </div>
          </>
        ) : isPro ? (
          <>
            <h3>
              <SparklesIcon size={15} /> DiskBytes Pro
            </h3>
            <div className="db-license-status">
              <div className="db-license-status-head">
                <span className={`db-license-chip ${posture === "grace" ? "offline" : "active"}`}>
                  <i className="db-dot" />
                  {posture === "grace"
                    ? `Offline · ${status?.graceDaysLeft ?? 0} days left`
                    : "Status: Active"}
                </span>
                {status?.simulated && <span className="db-license-sim">CI SIM</span>}
              </div>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{status?.customerName || "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{status?.customerEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>{status?.tier === "yearly" ? "Yearly" : "Lifetime"}</dd>
                </div>
                <div>
                  <dt>Active until</dt>
                  <dd>{activeUntilLabel(status?.licenseExpiresAt ?? 0, status?.tier ?? "")}</dd>
                </div>
              </dl>
              {posture === "grace" && (
                <p className="db-license-note">
                  Reconnecting validates automatically — everything keeps working offline for{" "}
                  {status?.graceDaysLeft ?? 0} more day{(status?.graceDaysLeft ?? 0) === 1 ? "" : "s"}.
                </p>
              )}
              <p className="db-license-thanks">Thank you for purchasing DiskBytes.</p>
            </div>
            <div className="db-dialog-actions">
              <button type="button" className="db-outline auto" disabled={busy} onClick={() => void validateNow()}>
                {busy ? "Checking…" : "Validate now"}
              </button>
              <button type="button" className="db-outline danger auto" disabled={busy} onClick={() => void deactivate()}>
                Deactivate
              </button>
              <button type="button" className="db-ink-button auto" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : posture === "degraded" ? (
          <>
            <h3>
              <LockKeyholeIcon size={15} /> License check needed
            </h3>
            <p>
              DiskBytes couldn't reach the license server for over 14 days, so
              Pro features are paused. Reconnect to the internet and check now —
              your license and data are safe.
            </p>
            {error && <div className="db-license-msg error" role="alert">{error}</div>}
            <div className="db-dialog-actions">
              <button type="button" className="db-outline auto" onClick={onClose}>
                Later
              </button>
              <button
                type="button"
                className="db-ink-button auto"
                disabled={busy}
                onClick={() => void validateNow()}
              >
                {busy ? "Checking…" : "Reconnect now"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              <LockKeyholeIcon size={15} /> Activate DiskBytes
            </h3>
            <p>
              Paste the license key from your purchase email. One key covers one
              Windows PC and one Mac.
            </p>
            <div className="db-license-body">
              <label>
                LICENSE KEY
                {/* Raw text as typed — completeness drives the button
                 * swap; normalization happens Rust-side. */}
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="DB-XXXXX-XXXXX-XXXXX-XXXXX"
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  aria-label="License key"
                />
              </label>
              {error && <div className="db-license-msg error" role="alert">{error}</div>}
              {complete && !error && (
                <div className="db-license-msg ok">Key looks complete — you're ready to activate.</div>
              )}
              <div className="db-license-perks">
                <div><SparklesIcon size={13} /> Full-disk map, cleanup, duplicates & snapshots</div>
                <div><CheckIcon size={13} /> Live monitor, always free</div>
                <div><CheckIcon size={13} /> 14-day offline grace</div>
              </div>
            </div>
            <div className="db-dialog-actions">
              <button type="button" className="db-outline auto" onClick={onClose}>
                Later
              </button>
              {complete ? (
                <button
                  type="button"
                  className="db-ink-button auto"
                  disabled={busy}
                  onClick={() => void activate(key.trim())}
                >
                  <KeyIcon size={14} />
                  {busy ? "Activating…" : "Activate"}
                </button>
              ) : (
                <button type="button" className="db-ink-button auto" onClick={openPurchase}>
                  Purchase Licence
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
