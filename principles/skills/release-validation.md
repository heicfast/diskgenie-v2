# Release-validation protocol

1. Confirm clean portable gates and target-native Windows/macOS builds/tests.
2. Validate packaging, update/licensing localhost contract, capabilities, and the
   purposeful screenshot matrix.
3. Run realistic performance/regression suites and retain raw machine-readable
   artifacts plus environment manifests under `codex/`.
4. Review unsafe/FFI, dependencies/advisories/licenses, workflow permissions,
   secrets, SBOM/provenance, known limitations, and rollback.
5. Verify artifacts install/launch and expose the correct source-of-truth version.

No release-ready label until each required gate has evidence or a documented,
user-approved exception.
