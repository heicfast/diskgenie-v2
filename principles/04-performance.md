# Performance engineering

## Rules

1. Define the user-visible goal and resource budget.
2. Measure release builds on a named workload and hardware profile.
3. Profile wall time, CPU, I/O, allocations/RSS, locks, and event volume.
4. Change algorithm/data flow before micro-optimizing syntax.
5. Compare correctness and resource use as well as elapsed time.

Do not promise “seconds” for an arbitrary data size or device. Report performance
by file count, total/logical/physical bytes, candidate distribution, filesystem,
storage class, cache state, workers, and machine.

## Scan and duplicate pipeline

- Enumerate with bounded memory and emit coarse, rate-limited progress.
- Group by exact size before reading content; singleton sizes cannot duplicate.
- Use staged evidence for candidate groups: metadata/identity where safe,
  prefix and strategically selected samples, then authoritative full comparison.
- A fast non-cryptographic digest may partition candidates; a strong full digest
  and/or byte comparison establishes equality according to documented policy.
- Detect hard links/file identity so the same physical data is not advertised as
  reclaimable duplicates.
- Reuse bounded per-worker buffers. Tune read sizes and workers by device class;
  more workers can reduce HDD and remote-volume throughput.
- Keep I/O scheduling, hashing, grouping, and presentation separable so each can
  be benchmarked and changed independently.

## Memory and layout

- Pre-size only where estimates are reliable; cap retained results and queues.
- Prefer compact contiguous scan records and IDs over repeated path/string data.
- Add `SmallVec`, arenas, interning, memory maps, SIMD, or custom allocators only
  after a profile demonstrates the bottleneck and tests cover fallback/spill.
- Track peak RSS and allocations under concurrency. Avoid multiplying large
  buffers by files or tasks.

## Benchmark contract

Each benchmark records app commit, OS/build, CPU, RAM, storage/filesystem, power
mode, dataset manifest/seed, warm/cold state, config, repetitions, median and
tail distribution, correctness digest, bytes read, CPU time, peak RSS, and errors.
Store raw machine-readable output under `codex/` or as CI artifacts.

Claims require a before/after comparison under the same contract and a stated
variance/regression threshold. Microbenchmarks support but never replace the
end-to-end workload.

