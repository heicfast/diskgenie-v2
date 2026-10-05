# Reliability and safety

## Filesystem truth

- Paths are byte/OS strings, not guaranteed UTF-8 display strings.
- Files can disappear, change, become inaccessible, change identity, or turn
  into links between enumeration and action. Revalidate at destructive time.
- Detect and define policy for symlinks, junctions/reparse points, hard links,
  sparse/compressed files, cloud placeholders, bundles, mount boundaries,
  network shares, removable media, permission errors, and filesystem cycles.
- Separate logical size, allocated size, and reclaimable size in data and UI.
- Do not follow links or cross volumes by accident. Platform adapters expose the
  identity and traversal policy used.

## Destructive operations

- Default to recoverable trash/recycle-bin semantics. Permanent deletion is an
  explicit, separately confirmed operation.
- Preview the exact targets, excluded items, uncertainty, and expected reclaim.
- Revalidate file identity and relevant metadata immediately before action.
- Execute with a journal/result per item; partial failure is reported precisely
  and never represented as complete success.
- Duplicate candidates require authoritative byte equality before any automatic
  recommendation. Hashes reduce comparisons; they are not permission to delete.
- Preserve at least one verified copy per duplicate set and explain keeper logic.

## Failure and recovery

- Cancellation yields a defined state, frees handles/workers, and never commits
  an incomplete destructive plan.
- Crashes, restarts, sleep/wake, volume removal, low disk/memory, and API timeouts
  must have explicit recovery behavior.
- Logs use stable event names and correlation IDs but never license secrets,
  authorization headers, sensitive paths by default, or file contents.

## Security and dependencies

- Minimize privileges and capabilities. Treat UI/IPC input as untrusted.
- Validate path scope and request size at the Rust boundary.
- Pin/lock dependencies, review advisories and licenses, and minimize enabled
  features. Unsafe/transitive surface is part of dependency selection.
- Threat-model cleanup, shell integration, update, licensing, and telemetry
  changes before implementation.

