# Testing strategy

## Layers

- Unit tests: pure policies, parsing, grouping, selection, state transitions.
- Property tests: path/data invariants, grouping equivalence, ordering, progress,
  cancellation, and “never delete final copy.”
- Model/differential tests: optimized engine versus a simple trusted oracle.
- Integration tests: filesystem adapter, IPC contracts, database/network edges.
- End-to-end tests: licensed/unlicensed UI journeys with a local server.
- Native tests: Windows and macOS APIs, packaging, trash, permissions, volumes.
- Benchmarks: micro, pipeline, and end-to-end under the performance contract.

## Realistic deterministic corpora

Generate fixtures from versioned manifests and seeds. Vary file count and size,
duplicate-group distribution, extension/content mismatch, empty and tiny files,
large files, nested depth, Unicode/non-UTF paths, hard/symbolic links, sparse
files, permission/lock errors, concurrent mutation, timestamp collisions,
network latency, volume removal, low space/memory, and cancellation points.

Do not commit huge generated blobs. Generate efficiently on the target; record
manifest, seed, generated logical/physical size, and correctness digest.

## Scale without low-value test count

“Thousands of tests” should come from generated cases and property/model runs,
not thousands of copied test functions. Track scenario coverage, mutations,
platform contracts, regression corpus, and failure diagnostics.

## Determinism and diagnostics

- Inject clock, randomness, filesystem, network, and license server boundaries.
- Every failure reports seed, scenario, phase, relevant path identity, expected
  and actual result, timings, resource counters, and log/artifact location.
- UI screenshot data, viewport, theme, platform, animation state, and font setup
  are fixed and recorded.

