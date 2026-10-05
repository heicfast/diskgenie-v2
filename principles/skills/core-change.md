# Core-change protocol

1. State the user/domain invariant and observable contract.
2. Index definitions, references, callers/callees, errors, tests, and UI consumers.
3. Choose ownership, lifecycle, concurrency, and platform seams explicitly.
4. Write/adjust focused contract and error tests before the coherent patch.
5. Run fmt, Clippy, targeted/full tests, and affected performance checks.
6. Record compatibility, resource, cancellation, and platform consequences.

Reject convenience clones, hidden fallback, unbounded work, broad lint allows,
and new panic/unsafe surfaces without the evidence required by the principles.

