# Observability and supply chain

## Product diagnostics

- Use structured job/scan spans with opaque correlation IDs and schema version.
- Record stage time and counters for discovery, metadata, bucketing, partial/full
  hashing, verification, aggregation, IPC delivery, and cleanup.
- Measure files/bytes considered and read, skips by reason, hard-link collapse,
  retries, queue depth, worker utilization, allocation/peak RSS, event latency,
  cancellation latency, and errors by stable code.
- Progress derives from measurable work and uses an “estimating” state when the
  denominator is unknown. Do not fabricate precise ETAs.
- Rate-limit and sample diagnostics. Never emit an info event per file.
- Paths, license/customer/device material, file contents, and stable identifiers
  are redacted by default. Diagnostic export is explicit and reviewable.

## Dependencies and build provenance

- Commit lockfiles and pin the supported toolchain/MSRV intentionally.
- Run advisory and license/source policy checks (`cargo audit`/`cargo deny` or
  current equivalents, plus npm audit policy) with documented triage.
- Review default features, transitive unsafe surface, maintenance, platform
  support, binary impact, and license before adding a dependency.
- Pin third-party Actions to immutable revisions, minimize workflow permissions,
  and prevent untrusted code from receiving secrets.
- Generate release provenance/SBOM where supported; sign and validate distributable
  artifacts. Scan for secrets before publishing.
- Dependency update automation opens reviewable changes and must not bypass the
  platform, behavior, or performance gates.

## Incident-ready behavior

Stable error/event codes connect user-visible failures, logs, support bundles,
tests, and runbooks. Document detection, containment, key/credential rotation,
rollback, and recovery for cleanup, update, licensing, telemetry, and packaging.

