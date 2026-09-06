# omarchy-browser repo map

Fork of `browseros-ai/BrowserOS` being made Omarchy-first. The repo is a monorepo with two main subsystems: the Chromium browser and the agent platform.

## Top-level

- `packages/browseros` — Chromium fork: patches, build system, signing, OTA updates.
- `packages/browseros-agent` — Bun monorepo: MCP server, extension UI, CLI, shared packages, Rust crates.
- `docs/` — product docs and marketing images.
- `tools/` — release secrets and build helpers.
- `signatures/` — signing resources.
- `updates/` — OTA update manifests for browser, extensions, and server.

## packages/browseros-agent

### apps/

- `app/` — WXT React extension: new tab, side panel, settings pages, and the Brain UI.
- `server/` — Bun Hono server: exposes MCP tools, drives the browser through CDP, runs the AI SDK agent loop.
- `claw-app/` — BrowserOS neo dashboard: watch/replay agent sessions.
- `claw-server-rust/` — Rust backend for neo agents (MCP endpoint agents connect to).
- `app-onboard/` / `claw-onboard/` — first-run onboarding flows.
- `cli/` — Go CLI for controlling BrowserOS from the terminal or other agents.

### packages/

- `shared/` — constants, types, schemas, env helpers.
- `browser-core/` / `browser-mcp/` — browser CDP abstractions and MCP bridge.
- `cdp-protocol/` — typed Chrome DevTools Protocol bindings.
- `agent-mcp-manager/` — MCP client/server registry.
- `acpx-ai-provider/` — AI provider integrations.
- `claw-api` / `claw-api-client` — API contract and generated client.
- `omarchy/` — new Omarchy desktop integration package.
- `onboarding-video/` — onboarding media.

### crates/

- `claw-api` — Rust API types.
- `browseros-cdp` / `browseros-core` / `browseros-mcp` — Rust browser/MCP core.
- `harness-integrations` — third-party integrations.

### contracts/

- `claw-api/` — OpenAPI/GraphQL schemas.
- `claw-mcp/` — MCP contract tests.

### scripts/ & tools/

- Build scripts, CDP codegen, env migration, local dev runner, and packaging tools.

## Omarchy integration touchpoints

- `@browseros/omarchy` (`packages/omarchy/`) — local Omarchy API client (starts with `hyprctl`).
- `apps/server/src/api/routes/omarchy.ts` — Hono REST routes that expose Omarchy APIs.
- `apps/app/screens/omarchy/` — settings UI for Omarchy desktop state.
- `apps/app/entrypoints/app/App.tsx` — route registration.
- `apps/app/components/sidebar/SettingsSidebar.tsx` — settings navigation entry.
