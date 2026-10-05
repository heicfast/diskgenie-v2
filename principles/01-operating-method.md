# Operating method

## Before editing

1. Read [the root index](../PRINCIPLES.md) and the relevant linked principles.
2. Check `git status --short --branch`; preserve unrelated user changes.
3. Map the current behavior end-to-end: UI intent, IPC command/event, core call,
   platform adapter, persistent/network side effect, and returned view state.
4. Capture the baseline with the smallest repeatable test or benchmark that
   represents the reported problem. Record environment and data shape.
5. State the invariant, success metric, risk, and rollback seam in `codex/`.

Maintain indexes under `codex/index/` for Rust symbols/modules/call graphs,
UI-to-core wiring, platform divergence, and measured hotspots. Text search finds
candidates; definition/reference/call inspection establishes impact.

## Change shape

- Prefer small vertical changes that can be verified from core to UI.
- Separate semantic/correctness changes from optimizations and visual restyling.
- Preserve a comparison path for risky engine replacements until parity and
  performance are demonstrated.
- Prefer boring, explicit code. Abstraction must remove repeated policy or make
  an invariant enforceable; it must not merely shorten code.
- Make invalid or dangerous states difficult to represent with domain types,
  constructors, and explicit state transitions.

## Evidence loop

For each increment: reproduce, measure, change, run focused tests, remeasure,
inspect UI if applicable, run wider gates, record the result. Revert hypotheses
that do not produce the expected outcome.

For substantial work use `codex/worklogs/<task>/trace.md`, `findings.md`, and
`decision.md`. Update after two significant operations, every error, and before
commit. After three materially similar failures, stop patching symptoms and
revisit the design and domain assumptions.

## Completion standard

A task is done only when behavior, errors, cancellation, logs, documentation,
tests, cross-platform impact, and user-facing state are handled. Passing one
happy-path test is not production readiness.
