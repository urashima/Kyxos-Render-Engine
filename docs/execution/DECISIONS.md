# Execution Decisions

## ED-001 — GitHub app is the remote write path in this execution environment

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use the authenticated GitHub app for remote branch creation, commits, pull requests, CI inspection, merges, and repository metadata. Use the reconstructed local workspace for implementation and tests.
- **Candidates:** Conventional `gh` plus local `git`; unauthenticated HTTPS Git; GitHub app.
- **Reason:** `gh` is absent and HTTPS Git has no private-repository credential, while the requested GitHub app has administrator access.
- **Impact:** Remote commit SHAs are authoritative. Every remote write is verified by fetching the resulting branch files or commit metadata. This does not affect engine architecture, WebGPU, or WebGL2.
- **ADR required:** No; this is an execution-environment decision, not a product architecture decision.

