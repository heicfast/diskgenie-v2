# Licensing architecture

## Trust boundaries

- The server is authoritative for activation policy; the signed entitlement is
  authoritative for offline client verification within its documented lifetime.
- Never ship admin keys, signing private keys, test bypasses, or reusable secrets.
- Client identifiers are privacy-minimized, versioned, and tolerant of legitimate
  hardware/OS changes according to explicit policy.
- Activation, validation, refresh, deactivation, offline grace, clock anomaly,
  revocation, reinstall, device limit, and server outage are explicit states.

## Protocol and storage

- Version request/response schemas and validate sizes/types at both boundaries.
- Authenticate sensitive requests; prevent replay where the threat model requires
  it; use constant-time verification and key rotation identifiers.
- Store local credentials in platform-appropriate protected storage where
  available. Logs and analytics never include raw keys, tokens, signatures, or
  stable device material.
- Define idempotency and safe retry behavior. Rate limits distinguish abuse from
  ordinary offline/retry scenarios.

## Tests

CI starts an ephemeral local license server with disposable keys and isolated
storage, waits on a health check, executes the client matrix, and retains
redacted logs. Cover valid, expired, revoked, malformed/tampered, replayed,
wrong-product/version, device-limit, clock shift, timeout, partial response,
server restart, and key-rotation cases.

Production bypass features must be impossible to enable in release artifacts.
Add a build/inspection assertion rather than relying on convention.

