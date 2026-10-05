# DiskGenie engineering principles

This is the required entry point for any agent or engineer changing DiskGenie.
Read this file and every principle linked by the change's row before coding.

## Product objective

DiskGenie must help users understand and safely reclaim storage. Correctness,
recoverability, responsiveness, accessibility, and honest measurements outrank
novelty. A visual feature is incomplete until it is wired to real core behavior;
a core optimization is incomplete until users can understand and control it.

## Required reading matrix

| Change area | Read before work |
|---|---|
| Any change | [Operating method](principles/01-operating-method.md), [quality gates](principles/08-quality-gates.md) |
| Rust/core | [Rust design](principles/02-rust-design.md), [reliability and safety](principles/03-reliability-safety.md) |
| Scan/duplicates/performance | [Performance](principles/04-performance.md), [testing](principles/07-testing.md) |
| Windows/macOS/filesystem | [Platform contracts](principles/05-platform-contracts.md), [reliability and safety](principles/03-reliability-safety.md) |
| React/Tauri/UI | [Experience](principles/06-experience.md), [platform contracts](principles/05-platform-contracts.md) |
| Tests/benchmarks/CI/releases | [Testing](principles/07-testing.md), [quality gates](principles/08-quality-gates.md) |
| Licensing/server/API | [Reliability and safety](principles/03-reliability-safety.md), [licensing](principles/09-licensing.md) |
| Observability/dependencies/security | [Observability and supply chain](principles/10-observability-supply-chain.md) |

## Non-negotiable rules

1. Establish a reproducible baseline before claiming improvement.
2. Preserve or intentionally version observable contracts; test parity first.
3. Never make deletion, cleanup, activation, or data-loss decisions from a
   probabilistic or partial result alone.
4. Keep expensive work off the UI thread. Progress must be monotonic, bounded,
   cancellable, and rate-limited across the Tauri boundary.
5. Bound concurrency, memory, open handles, event frequency, and retained scan
   state. “Parallel” never means “unlimited.”
6. Treat Windows and macOS as equal release targets with explicit platform
   adapters and shared contract tests.
7. Do not hide failures behind fallback behavior. Degrade only when the user can
   still get a correct result and the degradation is observable.
8. No performance, superiority, or release-readiness claim without stored,
   comparable evidence.
9. Review licenses before borrowing code. Learn patterns; do not copy code whose
   license is incompatible with this project.
10. Finish with local formatting, linting, type, test, and build gates before
    spending CI capacity.

## Evidence hierarchy

Use, in order: measured DiskGenie behavior; platform/vendor documentation;
stable Rust and dependency documentation; reproducible reference implementation;
article or anecdote. Reference projects inspire hypotheses, not proof.

## Work records

Maintain concise decisions, commands, measurements, screenshots, and workflow
artifacts under [`codex/`](codex/README.md). Do not store secrets or user data.
Use the task protocol index under [`principles/skills/`](principles/skills/README.md)
for performance, platform, destructive, UI, licensing, and release work.
