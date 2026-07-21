# Execution Decisions

## ED-001 — GitHub app is the remote write path in this execution environment

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use the authenticated GitHub app for remote branch creation, commits, pull requests, CI inspection, merges, and repository metadata. Use the reconstructed local workspace for implementation and tests.
- **Candidates:** Conventional `gh` plus local `git`; unauthenticated HTTPS Git; GitHub app.
- **Reason:** `gh` is absent and HTTPS Git has no private-repository credential, while the requested GitHub app has administrator access.
- **Impact:** Remote commit SHAs are authoritative. Every remote write is verified by fetching the resulting branch files or commit metadata. This does not affect engine architecture, WebGPU, or WebGL2.
- **ADR required:** No; this is an execution-environment decision, not a product architecture decision.

## ED-002 — Pin a mutually supported Node, TypeScript, and lint toolchain

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use Node.js 24.14.0, pnpm 11.7.0, TypeScript 6.0.3, ESLint 10.7.0, and typescript-eslint 8.64.0 with exact versions and a frozen lockfile.
- **Candidates:** TypeScript 7.0.2 with the latest packages; TypeScript 6.0.3 with compatible stable lint packages.
- **Reason:** Current typescript-eslint declares TypeScript support below 6.1.0. The selected versions are mutually compatible and older than the active supply-chain minimum-release-age window.
- **Impact:** Reproducible CI and strict typing without unsupported parser behavior. No WebGPU or WebGL2 runtime impact.
- **ADR required:** No; upgrades remain routine dependency maintenance while strictness rules stay stable.
