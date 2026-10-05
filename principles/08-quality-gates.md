# Quality and release gates

Run the repository's exact scripts after discovery. At minimum, before push:

```text
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
npm run typecheck
npm test
npm run build
```

If a gate is not runnable on the current OS, run the portable subset locally and
document the native CI gate rather than claiming it passed.

## CI topology

Keep workflows focused:

1. General validation: Rust fmt/clippy/tests, UI type/tests/build, contract and
   dependency checks on ordinary changes.
2. Windows MSIX/Microsoft Store build and native tests.
3. macOS build/signing-ready validation and native tests.
4. Purposeful UI screenshot matrix for Windows and macOS.
5. Scheduled/manual performance and realistic-scale suites with raw artifacts.

Remove duplicated jobs only after mapping the coverage they provide. Cache by
lockfiles/toolchain, cancel superseded runs, use path filters cautiously, set
timeouts, minimize token permissions, pin third-party actions, and retain concise
summaries plus detailed artifacts.

## Release evidence

Release-ready requires green target builds, clean local portable gates, native
contract and end-to-end results, no unresolved destructive-operation defects,
reviewed UI matrix, baseline/regression performance data, dependency/security
review, licensing-localhost coverage, and documented known limitations.

“Better than competitors” is accepted only for a public, reproducible matrix of
equivalent features/workloads. Otherwise describe the measured DiskGenie result.

