# Codex work records

This directory contains concise, reproducible project evidence:

- `WORKLOG.md`: chronological actions, decisions, results, and blockers
- `research/`: repository indexes, comparison notes, and provenance
- `index/`: symbols, dependencies, call graphs, wiring, platform gaps, hotspots
- `worklogs/<task>/`: `trace.md`, `findings.md`, and `decision.md`
- `benchmarks/`: manifests and raw/processed measurements
- `artifacts/`: downloaded GitHub Actions artifacts, extracted in run folders
- `screenshots/`: reviewed UI evidence and manifests

Never store credentials, authorization headers, signing material, personal user
data, or unredacted sensitive paths. Large generated corpora are described by a
manifest and seed rather than committed.

Substantial task records follow the three-layer model: domain/user promise,
architecture/design choice, then implementation mechanism. Preserve unsuccessful
attempts and evidence; do not rewrite the record to imply a straight-line result.
