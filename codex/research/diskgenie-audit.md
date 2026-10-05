# DiskGenie baseline audit

Status: baseline completed 2026-10-05. This is a defect and opportunity ledger,
not a release claim.

## Release blockers

- Cleanup IPC accepts webview-provided `{ id, path, size }`; synthetic `id = 0`
  permits path-only deletion without proving that the path belongs to the scan,
  remains beneath an allowed root, or still has the scanned identity.
- Duplicate groups are formed from scanned size plus SHA-256 without a final
  byte comparison or destructive-time metadata revalidation.
- The macOS hardlink identity implementation existed but the caller compiled
  it only on Windows. The first remediation slice enables both platforms.
- Windows Turbo appears to use incorrect NTFS volume-data offsets and can enter
  a long raw-read section without responsive cancellation. Treat Turbo output
  as untrusted until corrected and tested on real NTFS fixtures.
- The duplicate UI previously allowed every copy to be staged independently,
  with a footer action silently choosing the first path as the survivor.
- Analytics previously replaced anonymous IDs with a raw license key or email.
- `/v1/verify` authenticated requests but did not consume its nonce.

## Performance baseline observations

- Duplicate work is size grouping, XXH3 prefix, XXH3 middle sampling, then full
  SHA-256. Fixed worker ranges, retained grouping maps, approximate byte
  counters, and absent skip-reason telemetry make tuning and diagnosis weak.
- The scanner can use all logical CPUs, allocates a large Windows directory
  buffer per worker, drops worker panics, and can translate root failures into
  an empty successful result.
- The frontend production bundle is currently about 797 kB minified / 252 kB
  gzip; several dynamic imports do not split because the same modules are also
  statically imported.

## Experience baseline

- Preserve the established anti-flicker contract: CSS `db-settle-in`,
  pre-paint `db-tab-snap`, mounted inspector transitions, delayed dialog/toast
  exits, pre-applied theme, reduced-motion support, and canvas rescaling while
  layout work is debounced.
- The browser mock is routed through the same `lib/ipc.ts` command seam. It is
  suitable for deterministic UI work, but native effects remain no-ops and its
  artificial command delay must not be treated as a native performance result.
- Screenshot workflows are oversampled and fixture behavior is not sufficiently
  deterministic. The release workflow set should be reduced to Windows MSIX,
  Microsoft Store, macOS, one general validation workflow, and two efficient
  screenshot workflows.

## License architecture follow-ups

- Add token `kid`, product/audience binding, and overlapping verification keys.
- Make administrative batch creation transactional and idempotent.
- Exercise activation, validation, replay, device-slot, grace, and revocation
  against an ephemeral local server in CI; production is never a test target.
