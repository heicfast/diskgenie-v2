# Cross-platform protocol

1. Define shared behavior and the native capability/error differences.
2. Put policy in the core and OS calls in explicit Windows/macOS adapters.
3. Extend fake-adapter contract tests and both native target suites.
4. Cover path encoding, identity, links, allocation size, permissions, volume
   removal, cancellation, and packaging implications.
5. Inspect the same UI states at supported viewports/scales on both targets.

An empty result is not an acceptable representation of unsupported behavior.

