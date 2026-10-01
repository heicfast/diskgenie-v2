# DiskGenie Licensing & Store Architecture (v2 — paid-only; wire v2.1)

Status: **implemented** (session 10 / uiux-15; hardening session 11 /
uiux-16 — the device-facts wipe fix, race-proof slot binding, rate
limiting, richer device claims, live E2E). Supersedes the Dodo Payments
design in doc 06. This document is the build plan AND the operating
reference for the two-repo system:

- **App** (this repo): Rust license client + command-layer gates + React
  activation/status UI + Microsoft Store MSIX packaging + Store auto-update.
- **License server** (PRIVATE repo `heictojpgpics/diskgenie-license-server`):
  Cloudflare Worker + D1 — key registry, device binding, Ed25519-signed
  entitlement issuance, revocation, admin API.

---

## 1. Product decision (owner, session 10)

- DiskGenie has **no free tier**. WinDirStat is free; we charge because we
  provide more value. Every capability except the **Monitor** tab requires
  an activated license.
- Two purchase options: **yearly** (expires 365 days after issue) and
  **lifetime**.
- One license = **one Windows device + one macOS device**. Once a platform
  slot is registered to a device, the key refuses activation on a second
  device of that platform (deactivate on the old device, or admin device
  reset, frees the slot). Same device (hardware match) may re-activate
  freely (reinstall, reset, re-image with same machine identity).
- Unlicensed state: Explore / Duplicates / Applications / Snapshots show
  the **Activation Gate**; any action button (Scan, Duplicates run,
  Snapshot, Cleanup…) triggers the activation dialog. "Later" dismisses
  it, nothing unlocks. Monitor keeps working (live telemetry only).

## 2. Layered security architecture

The Windows desktop reality: anything running on the customer's machine
can be inspected, patched, debugged. So the design never depends on a
single "if licensed" branch; it stacks layers so each failure mode still
leaves the valuable property protected:

| Layer | Implementation | Failure it covers |
|---|---|---|
| L0 rate limits | D1 fixed-window counters per key + per IP on activate/validate/deactivate (10/60/10 per hour; the 429 `RATE_LIMITED` contract) | brute-force noise, budget abuse |
| L1 TLS | HTTPS to the Worker only | network observers |
| L2 request auth | HMAC-SHA256 over (ts, nonce, method, path, body-sha256) with a shared client secret + ±300 s window + nonce replay rejection in D1 | casual curl/scan abuse of the public endpoint (friction — the secret ships in a public-source binary; documented as such) |
| L3 server-side entitlement | D1 license status/expiry/device slots — the Worker REFUSES to issue tokens for bad keys | local UI patching (no valid token can be minted) |
| L4 signed entitlement | Ed25519-signed compact token (payload.sig); the client verifies with the **embedded public key** and rejects everything else | **license-server spoofing / response mimicry** — a fake server cannot forge a signature; the private key never leaves the Worker |
| L5 device binding | hardware fingerprint (SHA-256 of MachineGuid + system-volume serial + CPUID on Windows; IOPlatformUUID + root fsid + CPU brand on macOS) inside the signed payload; the client re-derives it every check. The composite algorithm is FROZEN (v1 activations re-match). v2 adds per-COMPONENT hashes (machine/volume/cpu hashed separately, stored in the device row) — swap forensics for support, not a new binding | copying `license.bin` to another machine (also DPAPI/Keychain-wrapped at rest) |
| L5b slot invariant | the 1 Windows + 1 macOS rule is enforced by a PARTIAL UNIQUE INDEX in D1 (`idx_devices_live_slot`), not by check-then-insert code — INSERT and the atomic conditional revive map constraint failures to DEVICE_SLOT_TAKEN | concurrent activations double-registering a slot (v1 TOCTOU) |
| L6 command-layer gates | every privileged Tauri command (`start_scan`, `start_scan_turbo`, `find_duplicates`, `commit_cleanup`, `take_snapshot`, `diff_snapshots`, `delete_snapshot`, `uninstall_app`) re-checks posture in Rust | hiding/disabling UI is not the boundary; the operation itself refuses |
| L7 binary hardening | existing release profile (symbols stripped, LTO, panic=abort); MSIX Store-signed at distribution | tampered binaries lose the Store signature (Microsoft signs on ingest) |
| L8 24 h revalidation | scheduler thread validates every 24 h + at launch; explicit server "invalid" deactivates locally | long-term abuse of stale state |
| L9 revocation & expiry | Worker marks licenses revoked/expired → next 24 h check (or activation) fails; tokens carry `lexp` so expired yearly licenses self-invalidate even offline | refunds, chargebacks, sharing |
| L10 audit telemetry | every activate/validate/deactivate/denied appended to `audit_events` (no raw keys, no full hw, salted IP hash) | abuse detection / support forensics |

The private Ed25519 signing key exists ONLY as a Worker secret. The app
embeds only the public key. Consequence: a user who redirects
`license.diskgenie.app` to a local mimic server gets structurally valid
JSON back, but the signature check fails → treated as a hard validation
failure, never as a license.

What this deliberately does NOT attempt: defeating a determined attacker
who patches the release binary to skip verification entirely. That class
requires code signing + OS-level enforcement; we use the Microsoft Store
signature for distribution integrity, and accept the residual risk (same
trade every desktop ISV makes without kernel anti-tamper).

## 3. Cryptographic design

### 3.1 Entitlement token (the signed unit)

```
token := b64url(payload_json) || "." || b64url(ed25519_sig(payload_json))
```

payload:

```json
{
  "iss": "db-license",       // fixed issuer
  "ver": 1,                  // format version
  "jti": "<16B hex random>", // unique per issuance
  "iat": 1730000000,         // issued-at (unix)
  "exp": 1731206400,         // iat + 14 days — the offline grace window
  "key": "<sha256(key) hex>",// binds token to THIS license key
  "tier": "yearly" | "lifetime",
  "name": "Alex Morgan",     // customer display name
  "email": "alex@example.com",
  "hw": "<64-hex hardware fingerprint>",
  "plat": "windows" | "macos",
  "lexp": 1761536000 | null  // license expiry (yearly) — null for lifetime
}
```

Client acceptance criteria (ALL must hold):
1. Ed25519 signature verifies against the embedded public key.
2. `iss`/`ver`/`plat` match; `key` == sha256(normalized stored key).
3. `hw` == freshly computed local hardware fingerprint.
4. `exp` > now (token grace window) and `iat` <= now + 300 s.
5. `lexp` is null or > now (license itself not expired).

Server mints a fresh token on every successful activate/validate; the
client persists the newest one (DPAPI/Keychain-wrapped) and the posture
clock derives from it — offline operation is exactly "the last signed
token is still inside its grace window".

### 3.2 Request authentication (app → Worker)

Headers on every app request:

```
X-DB-App: diskgenie
X-DB-Version: <semver>
X-DB-Timestamp: <unix ms>
X-DB-Nonce: <16B hex, once per request>
X-DB-Signature: hex(HMAC-SHA256(CLIENT_SECRET, ts || nonce || method || path || sha256(body)))
Content-Type: application/json
User-Agent: DiskGenie-License-Client/1
```

Worker: constant-time compare, ±300 s window, nonce single-use
(`nonce_seen` table), method+path+body bound. Admin routes use
`X-Admin-Key` (separate secret, constant-time compare). No CORS headers
are emitted anywhere — browsers cannot call the API cross-origin.

### 3.3 License key format

`DB-XXXXX-XXXXX-XXXXX-XXXXX` — Crockford base32 (no I/L/O/U), 20 random
characters = **100 bits** entropy. Normalization: uppercase, strip
non-alphanumerics → 22 chars. Stored server-side ONLY as
`sha256(normalized)` (raw keys exist once, in the generation response and
the customer's email). Key-hash lookups are indexed. UI shows the
"Activate" button only when the normalized key is complete (22 valid
chars) — "Later" + "Purchase Licence" before that.

### 3.4 The v2 device claim (what activation AND every revalidation send)

```
platform, hardwareHash           // the binding identity (unchanged)
hostname, osVersion, appVersion  // display + audit
compMachine, compVolume, compCpu // per-component sha256s (swap forensics)
cpuBrand, ramMb, machineModel    // display (SMBIOS / sysctl)
```

Server storage rule: **COALESCE-only writes** — a claim that omits a
field NEVER blanks the stored one. This is the fix for the v1 bug
where the 24 h revalidation (which sent no facts) wiped
hostname/os_version/app_version on every licensed install (the
owner-reported "doesn't save hostname / Windows version"). Change
detection diffs each revalidation against the stored row and audits
what changed (OS upgrade, app update, hostname rename) as structured
`device_update` events.

## 4. Protocol (Worker endpoints, all POST JSON)

| Route | Auth | Purpose |
|---|---|---|
| `/v1/activate` | request HMAC | bind device, mint first/refresh token |
| `/v1/validate` | request HMAC | 24 h revalidation, revocation check, fresh token |
| `/v1/deactivate` | request HMAC | free this device's platform slot |
| `/v1/health` | none | liveness (returns `{ok:true}`) |
| `/v1/admin/keys` | admin key | generate N keys (tier, customer, note, days) — returns the ONLY raw-key copy |
| `/v1/admin/keys/:id` | admin key | detail incl. devices |
| `/v1/admin/keys` GET | admin key | paged list (no raw keys) |
| `/v1/admin/keys/:id/revoke` | admin key | revoke license |
| `/v1/admin/keys/:id/renew` | admin key | extend expiry (days) |
| `/v1/admin/devices/:id/revoke` | admin key | free a device slot (support) |
| `/v1/admin/stats` | admin key | counts + recent audit |

Error contract (app-relevant):

| HTTP | code | client behavior |
|---|---|---|
| 400 | `BAD_REQUEST` | surface error text |
| 401 | `BAD_SIGNATURE` / `BAD_TIMESTAMP` / `REPLAYED` | surface; never unlocks |
| 403 | `KEY_REVOKED` / `KEY_REFUNDED` / `KEY_PENDING` | hard-fail → local deactivate + typed copy |
| 403 | `DEVICE_MISMATCH` | "already activated on another <platform>" copy |
| 409 | `DEVICE_SLOT_TAKEN` | slot occupied by different hardware → "contact support to move your license" copy (v2: no deactivate button) |
| 404 | `KEY_NOT_FOUND` | "Invalid license key" copy |
| 429 | `RATE_LIMITED` | typed copy; activate does NOT fast-retry (each attempt burns a window slot) |
| 5xx | — | network-class → grace path |

Activation logic: key lookup by hash → status `active`? → yearly not
expired? → device row for (license, platform, hw)? exists+active →
refresh; exists+revoked → reactivate same hardware? (reactivation of the
SAME hardware on a revoked-by-support row is allowed — it re-registers);
slot free? → insert; else `DEVICE_SLOT_TAKEN`. Every outcome → audit row.
Lightning-fast path: single indexed lookup + single device write; D1
single-region read latency ~ms from the Worker colocated in the same
Colo.

## 5. D1 schema (see `schema.sql` in the server repo)

- `licenses` (id, key_hash UNIQUE, key_last4, tier, status, customer_name,
  customer_email, note, source, issued_at, expires_at, created_at, updated_at)
- `devices` (id, license_id, platform, hardware_hash, hostname, os_version,
  app_version, comp_machine, comp_volume, comp_cpu, cpu_brand, ram_mb,
  machine_model, activated_at, last_seen_at, revoked) + the partial
  UNIQUE live-slot index `idx_devices_live_slot (license_id, platform)
  WHERE revoked = 0`
- `audit_events` (id, license_id, key_last4, event, platform, hw_prefix,
  reason, ip_hash, detail, created_at)
- `nonce_seen` (nonce PK, seen_at) — replay defense (TTL-swept)
- `rate_buckets` (bucket_key PK, window_start, count) — fixed-window
  rate counters (swept with the nonces)

No address column — the owner decision: billing address lives with the
payment processor; the license server needs identity (name, email) and
binding only. PII minimization is the compliance-friendly default.

## 6. Client (this repo) — module map

- `src-tauri/src/license.rs` — protocol client (`LicenseApi` behind the
  `LicenseHttp` seam), Ed25519 token verify, base64url, posture state
  machine, hardware fingerprint, DPAPI persistence. Public key const.
- `src-tauri/src/commands/license.rs` — `LicenseManager`, IPC commands
  (`license_status`, `activate_license`, `deactivate_license`,
  `validate_now`), 24 h scheduler thread, `require_licensed()` gate used
  by every privileged command, `ci-license-sim` test feature.
- `src-tauri/src/platform/win/store_update.rs` — Store auto-update
  (WinRT `StoreContext`, see §9).
- `src/state/license.ts` — zustand store (status, busy, error, success).
- `src/components/LicenseDialog.tsx` — activation + Pro status card.
- `src/components/ActivationGate.tsx` — the in-tab lock screen.
- `src/lib/licenseKey.ts` — key normalization/format/completeness (pure,
  unit-tested; shared by dialog + tests).

Posture semantics (strict):

- `unlicensed` — no key or never activated → locked (Monitor only).
- `pro` — valid token, last check < 24 h.
- `grace` — valid token, 24 h+ offline, `exp` not reached (≤ 14 days) →
  full features, banner "offline — N days left".
- `degraded` — token past `exp` → locked like unlicensed + reconnect copy.
  Yearly license past `lexp` → server says `LICENSE_EXPIRED` → local
  deactivate (renewal flow).

## 7. Frontend states

Activation dialog ("Activate DiskGenie"):
1. Empty key → buttons **Later** / **Purchase Licence** (opens the
   purchase page URL in the browser). Purchase page (external, owner
   roadmap) collects name + email + billing address; the payment webhook
   then calls the admin key-generation API and emails the key.
2. Key complete (22 normalized chars) → the primary button becomes
   **Activate** (with key icon, busy state "Activating…", typed error
   copy under the field, inline retry — transient network errors
   auto-retry twice with jitter before surfacing).
3. Success → "DiskGenie Pro activated — thank you for purchasing!" state
   (~1.4 s) → dialog closes itself; license chip flips to "Pro".

Pro status card (License chip / dialog): **Pro** title, `Status: Active`
chip, name, email, **Active until** `<date>` or `Lifetime`, tier row,
"Thank you for purchasing DiskGenie." + Validate now / Deactivate /
Done. Grace shows the offline-days row; degraded shows reconnect copy.

Locked tabs render `ActivationGate`: lock glyph, per-tab value pitch
("Explore — full-disk map, quick wins, safe cleanup…"), Activate +
Purchase buttons. Tab strip stays interactive (the pill/tour geometry is
untouched); a small dot marks locked tabs.

## 8. CI / screenshots simulation

`ci-license-sim` cargo feature (NEVER enabled in NSIS/MSIX/production
builds; only `ui-screenshots.yml` builds with `--features
ci-license-sim`): env `DISKGENIE_LICENSE_SIM=1` seeds a simulated
activated state at boot; the `license_sim_set` command (feature-gated)
lets the tour flip pro ↔ unlicensed. TourDriver gains steps:
`license-status-card` (Pro status card — name/email/active
till/thank-you), `license-locked` (sim off → Activation Gate), and the
existing `license-dialog` step now captures the Later/Purchase state and
the Activate state (typed key). Browser-dev mocks implement the same
command surface.

## 8b. LIVE end-to-end CI (`license-e2e.yml`, session 11)

A second opt-in cargo feature `live-license-e2e` (tests-only, never in
build artifacts) compiles `src-tauri/tests/live_license.rs`. The
workflow runs it on every push on a Windows runner against the REAL
deployed worker, with the repo secret `LIVE_ADMIN_KEY`:

generate a throwaway yearly key (days=1, self-expiring) → activate with
the full v2 claim → verify the returned token against the PRODUCTION
public key (the real anti-spoof path) → revalidate with CHANGED facts →
admin-lookup and assert the device row kept them (the v1 wipe
regression, LIVE) → assert DEVICE_SLOT_TAKEN for a second device →
deactivate → assert the slot freed → revoke for cleanup. Every run
mints its own key; customer data is never touched.

## 9. Microsoft Store distribution + auto-update

- **MSIX** (`msix-build.yml`): release exe + AppxManifest
  (Identity Name/Publisher templated from Partner Center values; version
  = app version + run number; `runFullTrust` + `internetClient`
  capabilities; TargetDeviceFamily ≥ 10.0.19041.0 — WebView2 Runtime is
  inbox there) + generated logo assets (44/50/150/310 assets from the
  committed icon source) → `MakeAppx pack` → artifact. The Store signs
  on submission, so CI produces the unsigned package (Partner Center
  validates + signs on ingest) — that is why we don't sign in CI.
- **Auto-update** (24 h, Windows, Store builds only): if
  `Package::Current().Id().SignatureKind == Store`, a scheduler calls
  `StoreContext::GetDefault()` →
  `GetAppAndOptionalStorePackageUpdatesAsync()` → when updates exist →
  `RequestDownloadAndInstallStorePackageUpdatesAsync(updates)` (the
  user-named WinRT APIs; `Windows.Services.Store`). Non-Store builds
  keep the NSIS channel (DISTRIBUTION.md).
- Store compliance carried in `docs/DISTRIBUTION.md`: reserved name
  match, identity publisher match, privacy policy URL (analytics +
  license server data), no admin rights required (currentUser install),
  WebView2 inbox requirement documented.

## 10. Configuration / deployment variables

Server (Worker secrets via `wrangler secret put`, vars via
`wrangler.jsonc`):
- `LICENSE_SIGNING_PRIVATE_KEY` — 64-hex Ed25519 seed (secret)
- `ADMIN_API_KEY` — 32+ char random (secret)
- `CLIENT_REQUEST_SECRET` — 64-hex HMAC secret, same value as the app
  const (secret; the app embeds it — see §2 L2 honesty note)
- `D1 binding DB` → database `diskgenie-license` (wrangler.jsonc)
- `TOKEN_TTL_DAYS` (var, default 14), `GRACE_24H` constants in code

App (compile-time consts, `src-tauri/src/license.rs`):
- `LICENSE_API_BASE` — e.g. `https://license.<your-domain>/` (change to
  your deployed Worker URL; env `DISKGENIE_LICENSE_API` overrides for
  tests/CI)
- `LICENSE_PUBLIC_KEY` — 32-byte Ed25519 public key (hex const; must
  match the server's private key)
- `CLIENT_SECRET` / `LICENSE_PURCHASE_URL` (Rust + UI copy)

Rotation: generate a new keypair → deploy Worker with the new private
key → ship an app update with the new public key → old tokens fail at
next validate (24 h) → users revalidate against the new key. Documented
in both READMEs.

Key lifecycle (senior-standard): keys are generated ONLY via the admin
API (or seed script for dev), delivered by email from the payment
webhook, never stored raw anywhere, revocable/refundable in one call,
device slots resettable per-device for support.
