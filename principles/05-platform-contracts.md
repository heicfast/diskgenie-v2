# Windows and macOS platform contracts

Windows and macOS are equal product targets. Shared UX does not mean pretending
their filesystems and shell APIs behave identically.

## Architecture

- Core policy and algorithms are platform-neutral.
- Platform adapters implement explicit traits for enumeration, file identity,
  allocated size, volumes, trash, reveal/open, privileges, startup/update, and
  system cleanup capabilities.
- Shared contract tests run against fake adapters; target runners execute native
  integration tests. Conditional compilation stays close to the adapter.
- Unsupported behavior is a typed capability result, not an empty success.

## Required platform cases

Windows coverage includes NTFS/ReFS/FAT/exFAT as applicable; drive roots and UNC;
reparse points/junctions; hard links; sparse/compressed/encrypted files; long and
non-Unicode paths; locked files; ACL denial; OneDrive placeholders; recycle bin;
MSIX/Store packaging; sleep/removal during work.

macOS coverage includes APFS/HFS+ as applicable; case-sensitive and insensitive
volumes; Unicode normalization; symlinks/hard links; sparse files and clones;
packages; iCloud placeholders; external/network volumes; permissions/privacy;
Trash; app bundle/signing/notarization; sleep/removal during work.

## UI parity

The same mode, state, copy, hierarchy, tokens, and interaction intent should be
visible on both platforms. Native titlebar/inset/font rendering differences need
explicit screenshot tolerances; they must not cause clipped, shifted, or missing
controls. Test at supported scale factors and constrained window sizes.

