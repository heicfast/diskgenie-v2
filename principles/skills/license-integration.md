# License-integration protocol

1. Version the client/server request, response, error, and entitlement contracts.
2. Model online, offline-grace, expired, revoked, device-limit, clock anomaly,
   malformed/tampered, rate-limited, and outage states.
3. Use an ephemeral localhost server/D1 with disposable keys for integration.
4. Assert signature verification, replay protection, retry/idempotency, redaction,
   rotation, and that production artifacts exclude all bypasses/secrets.
5. Coordinate both repositories and record rollout/rollback compatibility.

