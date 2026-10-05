# Destructive-operation safety protocol

1. Threat-model stale paths/identity, links, mount changes, partial failure, user
   selection error, cancellation, and loss of the final copy.
2. Separate discovery, verified plan, confirmation, revalidation, execution, and
   per-item result into explicit states.
3. Default to recoverable trash; require explicit permanent-delete intent.
4. Use a simple independent oracle plus property/fault tests.
5. Require a focused safety review before merge and native platform validation.

Partial fingerprints or hashes can filter candidates; only authoritative equality
and immediate identity revalidation can authorize a duplicate cleanup plan.

