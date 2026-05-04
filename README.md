# Codex Companion for iPhone

Codex Companion for iPhone is a native iOS supervision app for desktop Codex workflows. It is intentionally not a mobile IDE. The iPhone stays focused on progress tracking, approvals, artifact previews, and lightweight control while heavy coding, large diffs, and deep review remain on the desktop where context density and tooling are stronger.

## Architecture

### Text Diagram

```text
+---------------------+         local-only bridge          +----------------------+
|  Desktop Codex Run  | <--------------------------------> |   Desktop Helper     |
|  edits files local  |                                    |  Node/TypeScript     |
|  owns repo context  |                                    |  HTTPS + WSS API     |
+---------------------+                                    |  auth + pairing      |
                                                           |  thread state store  |
                                                           |  preview summaries   |
                                                           +----------+-----------+
                                                                      |
                                                              WSS / HTTPS
                                                                      |
                                                           +----------v-----------+
                                                           |  iPhone SwiftUI App  |
                                                           |  tabs + cache        |
                                                           |  approvals           |
                                                           |  live activity       |
                                                           |  offline/reconnect   |
                                                           +----------------------+
```

### Why Node/TypeScript For The Desktop Helper

Node/TypeScript was chosen because the helper is mostly an eventing, transport, and session-management service. It is a practical fit for:

- WebSocket and HTTPS/WSS transport
- JSON-first event contracts
- mock/demo adapters
- bridge integration with Codex App Server and local fallback adapters
- fast testing and iterative backend modeling

## Folder Structure

```text
packages/protocol/          TypeScript protocol package used by the helper
shared/openapi/             Shared OpenAPI contract
shared/json-schema/         Shared JSON schema assets
desktop-helper/             Secure Desktop Helper service + tests + dev TLS certs
ios/CodexCompanion/         SwiftUI iPhone app
ios/CodexCompanionWidget/   Live Activity widget extension
ios/CodexCompanionShared/   Shared Swift package, cache/networking/models/tests
project.yml                 XcodeGen project spec
CodexCompanion.xcodeproj/   Generated Xcode project
```

## Desktop Helper Responsibilities

- thread discovery
- thread snapshots and detail queries
- WebSocket event streaming
- lightweight command dispatch
- approval resolution
- artifact preview summaries
- health reporting
- device pairing
- auth refresh, logout, and trusted-device tracking

## Desktop Helper APIs

- `GET /health`
- `POST /pairing/code`
- `POST /pairing/exchange`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /devices`
- `POST /devices/:id/revoke`
- `GET /threads`
- `GET /threads/:id`
- `GET /threads/:id/preview`
- `POST /threads/:id/command`
- `POST /threads/:id/approval`
- `WS /events`

## Event Model

WebSocket messages are shaped as `{ event, data }` and support:

- `thread.created`
- `thread.updated`
- `task.phase_changed`
- `task.summary_updated`
- `artifact.generated`
- `approval.requested`
- `approval.resolved`
- `task.completed`
- `task.failed`
- `connection.health_changed`

On iPhone, these are reduced into:

- thread cards and status chips
- timeline summaries
- approval queue updates
- notification triggers
- Live Activity refreshes

## Pairing And Auth Model

1. The desktop helper generates a short-lived pairing code and QR payload.
2. The iPhone scans or pastes the pairing payload.
3. The app exchanges the code for access and refresh tokens.
4. Tokens are stored securely in Keychain.
5. Device metadata is stored locally in app preferences.
6. The helper maintains a trusted-device list and supports revoke/logout.

### Transport Security

- Mobile transport is HTTPS/WSS only.
- The demo build includes a pinned development certificate:
  - desktop helper serves `desktop-helper/certs/dev-cert.pem`
  - iOS pins `ios/CodexCompanionShared/.../DesktopHelperDevCert.cer`
- For a real deployment, replace the demo cert with a user-generated local certificate or a trusted local reverse proxy.

## Local Bridge Boundary

The helper models the Codex-facing side as an internal transport boundary instead of a public API.

Available bridge modes:

- `app-server`: preferred production integration; the helper starts `codex app-server`, speaks JSON-RPC over stdio, hydrates recent threads, maps thread/turn/item events into mobile-safe summaries, and resolves native App Server approvals
- `mock` (default): in-memory demo threads, approvals, artifacts, and event simulation
- `filesystem`: local fallback/test adapter that reads thread snapshots from `local-bridge/threads/*.json` and writes commands/approvals to NDJSON outboxes

This keeps the mobile-facing API stable while allowing the local Codex integration to evolve privately.

## iPhone App Features

- SwiftUI app with `Home`, `Approvals`, `Activity`, and `Settings`
- lightweight command composer
- structured event timeline
- compact artifact cards
- onboarding + pairing flow
- QR scanning
- offline cached state
- reconnect backoff
- stale-state handling
- local notification hooks
- APNs registration hook for future remote relay support
- Live Activity support for one selected active thread


## Build And Run

### Desktop Helper

```bash
npm install
npm run build
npm test
npm run dev --workspace @codex-companion/desktop-helper
```

### Shared Swift Package Tests

```bash
cd ios/CodexCompanionShared
swift test
```

### iPhone App

The repo already includes a generated Xcode project. If you update `project.yml`, regenerate it with:

```bash
xcodegen generate
```

Build from the command line:

```bash
xcodebuild -project CodexCompanion.xcodeproj -scheme CodexCompanion -destination 'generic/platform=iOS Simulator' build
```

## Verification Done In This Repo

- `npm run build`
- `npm test`
- `swift test` in `ios/CodexCompanionShared`
- `xcodebuild -project CodexCompanion.xcodeproj -scheme CodexCompanion -destination 'generic/platform=iOS Simulator' build`
