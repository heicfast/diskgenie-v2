# Sources and adoption policy

## Required references

- Apollo GraphQL, `rust-best-practices` (local clone under workspace references)
- Actionbook, `rust-skills` (local clone under workspace references)
- JetBrains, “Blazingly Fast or Blazingly Hyped? A Reality Check on Rewriting in Rust”
- kvark/jFransham, “Achieving warp speed with Rust”
- OneUptime, “How to Optimize Rust Memory Usage and Prevent Allocation Bottlenecks”

Local source notes live in the workspace `references/notes/` directory.

## Adoption policy

The durable themes are: correctness before cleverness, explicit ownership and
errors, bounded unsafe surfaces, profile before optimization, algorithm/layout
before micro-tuning, realistic tests, and incremental parity-driven change.

Do not copy blanket preferences without context. In particular, `parking_lot`,
crossbeam, `SmallVec`, arenas, memory mapping, custom allocators, `expect`, static
prefix conventions, aggressive inlining, or stack storage are not universal
improvements. Each must solve a measured project problem and pass the relevant
safety, maintenance, and platform gates.

The optimization gist contains older syntax and ecosystem assumptions. The
OneUptime snippets are illustrative and include unsafe/unwrap/leak patterns that
require production hardening. The JetBrains article supplies rewrite risk and
incremental-delivery evidence, not a benchmark for DiskGenie.

Reference repositories used later in this project are architectural comparison
material. Review their licenses before borrowing implementation. Record every
adopted idea and its independent implementation or attribution in `codex/`.

