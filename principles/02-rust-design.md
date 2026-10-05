# Rust design standard

## Ownership and data flow

- Borrow by default (`&str`, `&[T]`, `&Path`); own data at lifetime, thread, IPC,
  cache, or persistence boundaries.
- Do not clone to silence the borrow checker. Document hot-path clones whose
  ownership boundary is intentional.
- Pass small `Copy` values by value. Keep large records and heap-backed values by
  reference unless transfer is the contract.
- Favor contiguous records and stable IDs over graphs of `Arc<Mutex<_>>`.
- Keep transformation functions pure and side effects at adapters.

## APIs and types

- Use domain newtypes/enums for units, scan phases, digest stages, license state,
  and destructive-operation decisions.
- Constructors validate invariants. Private fields protect invariants.
- Prefer static dispatch in hot, closed sets; use `dyn Trait` at genuine runtime
  extension or platform seams. Delay boxing until the seam needs ownership.
- Use type-state only when it materially prevents illegal transitions; do not
  obscure simple runtime state machines.
- Public behavior includes cancellation, ordering, partial results, errors, and
  resource limits; document all of them.

## Errors and panics

- Libraries/core expose typed errors (`thiserror`) with actionable variants.
- Application boundaries may aggregate context, but must retain the source.
- Production input, I/O, platform, parsing, and network paths return `Result`;
  they do not `unwrap`, `expect`, or panic.
- An unavoidable invariant `expect` needs a message explaining why the invariant
  is guaranteed. Tests may use unwraps when failure remains obvious.
- Never silently swallow an error. Best-effort work logs structured context and
  exposes partial/degraded status when it affects the result.

## Concurrency and lifecycle

- CPU-bound batches use bounded workers/data parallelism; asynchronous code is
  for waiting on I/O, not a substitute for CPU scheduling.
- Never hold a lock across I/O, hashing, an IPC emit, callback, or `.await`.
- Define lock ordering; minimize shared mutable state; make cancellation cheap.
- Resources use RAII. Cleanup that can fail also has an explicit fallible close
  or commit operation; `Drop` remains best effort.
- Choose atomics and memory ordering only with a written invariant and tests.

## Unsafe and FFI

- Prefer safe platform APIs and owned handle wrappers.
- Every `unsafe` block has a `// SAFETY:` argument covering validity, alignment,
  lifetime, aliasing, thread, and ownership assumptions that apply.
- Keep unsafe code minimal and behind a safe API. Add boundary, concurrency, and
  invalid-input tests; run Miri where supported.

## Style and linting

Use rustfmt and workspace lints. Fix warnings rather than broad suppression.
When suppression is justified, prefer the narrowest `#[expect(...)]` with a
reason. Comments explain why, constraints, or safety—not syntax.

