# Future Improvements

## Near Term

- Add a desktop menu bar UI for pairing-code generation, QR rendering, and trusted-device revocation
- Persist helper state in SQLite instead of JSON files for more durable session/audit history
- Add push relay support so task completion can reach the phone even when the helper is not actively websocket-connected
- Expand artifact previews with richer screenshot metadata and preview thumbnails generated on desktop
- Add per-thread mute rules and notification preferences

## Medium Term

- Introduce a real local Codex adapter over a unix socket or named pipe instead of the filesystem demo bridge
- Add multi-desktop support so one phone can supervise several paired workstations
- Add cross-device handoff deep links from phone back into the desktop Codex app
- Add approval-policy templates so some low-risk actions can be auto-approved by repo or project
- Support read-only compact diff summaries with file-level risk indicators while still routing full review to desktop

## Longer Term

- Add an observability layer for historical throughput, flaky-command detection, and approval latency analytics
- Add signed pairing payloads and rotating certificate pin updates during trusted-device maintenance
- Add per-repository RBAC and team device management for shared desktop environments
- Add Apple Watch glance support for approvals and thread completion
- Add optional Git provider integrations for PR state, CI summaries, and desktop review routing
