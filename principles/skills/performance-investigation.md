# Performance-investigation protocol

1. Define workload, user SLO, resource budget, correctness oracle, and variance.
2. Capture release-mode stage metrics on the same dataset/environment.
3. Profile CPU, I/O, allocation, locks, queues, and IPC before hypothesizing.
4. Optimize in order: avoided work/algorithm, I/O, structure/layout, allocation,
   scheduling/parallelism, then target-specific techniques.
5. Rerun identical correctness and benchmark suites; include regressions.
6. Keep rollback/comparison until improvement is statistically and operationally
   meaningful on Windows and macOS.

No “seconds,” multiplier, or competitor claim without reproducible raw evidence.

