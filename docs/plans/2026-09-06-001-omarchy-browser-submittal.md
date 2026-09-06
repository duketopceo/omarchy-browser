---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
title: Omarchy-first Browser — roadmap to first upstream submittal
target: packages/browseros-agent
created: 2026-09-06
---

# Omarchy-first Browser — roadmap to first upstream submittal

## Problem & Goal

BrowserOS is an agentic browser; Omarchy is a Hyprland-based Arch desktop. The fork at `duketopceo/omarchy-browser` must become the **Omarchy-first browser**: it exposes Omarchy desktop state and controls to BrowserOS agents so the browser can read displays, workspaces, active windows, and settings, and the user can control them from the BrowserOS extension.

The first submittal is an upstream PR to `browseros-ai/BrowserOS` that lands a minimal, safe, and tested desktop-integration scaffold. Omarchy-specific logic stays behind a generic interface so upstream can adopt other Linux desktops later.

## Scope Boundary

**In scope for the first submittal**

- A new `@browseros/desktop` workspace package with a generic `DesktopClient` interface (queries and actions).
- A Hyprland/Omarchy implementation of that interface in the fork (`@browseros/omarchy`).
- One read-only REST route `GET /api/desktop/monitors` on the agent server.
- One settings page at `/settings/desktop` that lists monitors, with an Omarchy-branded sidebar entry for the fork.
- Unit tests for the package and server route.
- Cross-platform guards: if `hyprctl` or `HYPRLAND_INSTANCE_SIGNATURE` is missing, the API returns `{ available: false }` instead of crashing.
- CI-affected verification: `bun run lint`, `bunx turbo run typecheck --affected`, `bun run fallow`.

**Out of scope for the first submittal**

- Full Hyprland config read/write, keybindings, network/VPN, snapshots, and bulk actions.
- Chromium-level patches or the `packages/browseros` build.
- Production packaging, OTA, or release workflows.

## Requirements traceability

| Origin requirement | How it is satisfied in the first submittal |
|---|---|
| "make it omarchy first browser" | Fork keeps `@browseros/omarchy` and the `Omarchy` sidebar entry. |
| "every omarchy api. config, setting" | Roadmap maps remaining API surface after the first PR. The first PR proves the pattern with monitors. |
| "then pr back to the original too" | First PR lands generic `@browseros/desktop` + server route + settings page in upstream. |
| `packages/browseros-agent/CLAUDE.md` | Bun, extensionless imports, workspace packages, `@browseros/shared`, TanStack Query, Hono routes. |
| `apps/server/CLAUDE.md` | Routes live in `apps/server/src/api/routes/` and compose in `apps/server/src/api/routes/index.ts`. |
| `apps/app/CLAUDE.md` | Settings page uses WXT + React Router + shadcn primitives + TanStack Query. |

## Decisions & Rationale

1. **Introduce `@browseros/desktop` as a generic package.** Upstream is unlikely to accept a Hyprland-only package named `omarchy`. A generic interface lets other desktops plug in later and keeps the upstream PR focused.
2. **Keep `@browseros/omarchy` in the fork.** The fork is *Omarchy-first*, so it ships the concrete `DesktopClient` implementation plus Omarchy-branded UI labels. Upstream receives only the generic package and extension points.
3. **Read-only first.** `GET /api/desktop/monitors` and `GET /api/desktop/workspaces` are safe and do not require privileged mutations. Mutating endpoints (reload config, dispatch keys) come after the PR.
4. **Use `hyprctl -j` and guard on `HYPRLAND_INSTANCE_SIGNATURE`.** This matches the local environment and avoids failures on non-Hyprland systems.
5. **Use the existing REST lane, not GraphQL, for local agent-server endpoints.** The credits/agents hooks already demonstrate this pattern and avoid the app’s GraphQL codegen dependency.
6. **First submittal is intentionally small.** A scaffold PR is easier to review, gets CLA/CI green, and establishes the integration boundary before adding every API.

## Implementation Units

### IU-1 — Generic desktop package

**Files**
- `packages/browseros-agent/packages/desktop/package.json`
- `packages/browseros-agent/packages/desktop/tsconfig.json`
- `packages/browseros-agent/packages/desktop/src/types.ts`
- `packages/browseros-agent/packages/desktop/src/desktop.ts`
- `packages/browseros-agent/packages/desktop/src/index.ts`
- `packages/browseros-agent/packages/omarchy/package.json` (rename/refactor from current)
- `packages/browseros-agent/packages/omarchy/src/types.ts`
- `packages/browseros-agent/packages/omarchy/src/hyprctl.ts`
- `packages/browseros-agent/packages/omarchy/src/index.ts`

**What it does**
Define a `DesktopClient` interface (`getMonitors`, `getWorkspaces`, `isAvailable`) and a `createOmarchyClient()` factory. Move the current `hyprctl` parsing into the Omarchy implementation so `packages/desktop` is interface-only and platform-agnostic.

**Tests**
- `packages/browseros-agent/packages/omarchy/src/hyprctl.test.ts`
  - Parses a sample `hyprctl -j monitors` JSON and returns `HyprlandMonitor[]`.
  - Returns `{ available: false }` when `HYPRLAND_INSTANCE_SIGNATURE` is unset.
  - Returns an error (not a throw) when `hyprctl` exits non-zero.

### IU-2 — Server route

**Files**
- `packages/browseros-agent/apps/server/src/api/routes/desktop.ts` (new generic route)
- `packages/browseros-agent/apps/server/src/api/routes/omarchy.ts` (fork-specific route that re-exports or extends desktop)
- `packages/browseros-agent/apps/server/src/api/routes/index.ts`
- `packages/browseros-agent/apps/server/package.json` (add `@browseros/desktop` dependency)

**What it does**
`desktop.ts` exposes `GET /monitors` and `GET /workspaces` using the generic `DesktopClient`. The fork keeps `/api/omarchy` as an alias or thin wrapper for backwards compatibility. On non-Hyprland systems the route returns `503` with `available: false`.

**Tests**
- `packages/browseros-agent/apps/server/tests/api/routes/desktop.test.ts`
  - `GET /api/desktop/monitors` returns monitors when a mock client is provided.
  - `GET /api/desktop/monitors` returns `503` + `available: false` when no desktop client is available.
- `packages/browseros-agent/apps/server/tests/api/routes/omarchy.test.ts` (fork only)
  - `GET /api/omarchy/monitors` proxies to the desktop route.

### IU-3 — Settings UI

**Files**
- `packages/browseros-agent/apps/app/modules/desktop/desktop.hooks.ts`
- `packages/browseros-agent/apps/app/modules/omarchy/omarchy.hooks.ts` (refactor to use desktop query with `omarchy` endpoint)
- `packages/browseros-agent/apps/app/screens/desktop/DesktopSettingsPage.tsx`
- `packages/browseros-agent/apps/app/screens/omarchy/OmarchySettingsPage.tsx` (fork keeps this as a thin wrapper)
- `packages/browseros-agent/apps/app/components/sidebar/SettingsSidebar.tsx`
- `packages/browseros-agent/apps/app/entrypoints/app/App.tsx`
- `packages/browseros-agent/apps/app/package.json` (add `@browseros/desktop` dependency)

**What it does**
Add a TanStack Query hook `useDesktopMonitors` and `useDesktopWorkspaces`. The generic `/settings/desktop` page shows displays; the fork’s `/settings/omarchy` page uses the same data but is labeled `Omarchy`. This gives upstream a generic page and the fork a branded one.

**Tests**
- `packages/browseros-agent/apps/app/screens/desktop/DesktopSettingsPage.test.tsx` (optional, time-boxed)
  - Renders the page and shows a monitor card with `1920x1200`, scale `1.25`, focused `true`.
  - Renders an "Unavailable" state when the API returns `available: false`.

### IU-4 — Repo health & CI verification

**Files**
- All files above.
- `packages/browseros-agent/tsconfig.json` (add `@browseros/desktop` reference).
- `packages/browseros-agent/bun.lock`.

**What it does**
- `bun run lint` (Biome) passes.
- `bunx turbo run typecheck --affected` passes. This runs `codegen` first via turbo; if it fails, fix `.env.development` or `codegen.ts` config.
- `bun run fallow` passes (no circular deps, unused exports).

## Verification Contract

Before any PR is opened, the following must be green:

1. `cd packages/browseros-agent && bun run lint`
2. `cd packages/browseros-agent && bunx turbo run typecheck --affected`
3. `cd packages/browseros-agent && bun run fallow`
4. `cd packages/browseros-agent && bun run --filter @browseros/desktop test` (or `bun test packages/omarchy/src/hyprctl.test.ts` if no test runner is configured yet)
5. `cd packages/browseros-agent && bun run --filter @browseros/server test:main` (server test suite; the new route tests must pass)
6. Manual smoke: `cd packages/browseros-agent && bun run --filter @browseros/server start:server` (or `bun --watch --env-file=../../.env.development src/index.ts --config ../../config.dev.json`) and `curl http://127.0.0.1:SERVER_PORT/api/desktop/monitors` returns data on Omarchy.

## Definition of Done

- `feat/omarchy-first-browser` branch is rebased on `upstream/main` (or `browseros-ai/BrowserOS:main` merged in).
- All CI-affected checks in the Verification Contract are green locally.
- The generic `@browseros/desktop` package, server route, and settings page are committed and pushed to `duketopceo/omarchy-browser:feat/omarchy-first-browser`.
- A PR is opened to `browseros-ai/BrowserOS:main` with:
  - Conventional-commit title.
  - Description of the generic interface, the Omarchy implementation kept in the fork, and test plan.
  - Screenshot or CDP snapshot of `/settings/desktop`.
  - CLA comment: `I have read the CLA Document and I hereby sign the CLA`.

## Sequencing / Timeline

| Phase | Work | Target |
|---|---|---|
| 0. Harden scaffold | Fix any type/lint issues in the existing `@browseros/omarchy` slice; add tests; run `bunx turbo run typecheck --affected`. | Today |
| 1. Generic desktop package | Rename/refactor to `@browseros/desktop` + `@browseros/omarchy` implementation. | Today / tomorrow |
| 2. Server route + UI | Add `/api/desktop/monitors` and `/settings/desktop`; keep `/api/omarchy` and `/settings/omarchy` as fork aliases. | Tomorrow |
| 3. Verification | Run lint, typecheck, fallow, server tests; fix regressions. | Tomorrow |
| 4. PR prep | Rebase, squash, write PR body, screenshot, sign CLA, open PR. | Tomorrow |

This is an aggressive timeline. If any CI check fails on the full repo because of pre-existing issues (e.g. app GraphQL codegen), scope the first submittal to the package + server route only and open a follow-up PR for the UI.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Upstream rejects Omarchy-specific naming | Submit generic `@browseros/desktop` only; keep `@browseros/omarchy` in the fork. |
| `bunx turbo run typecheck --affected` fails on app because of missing `generated/graphql` | Run `bun run codegen:agent` with `.env.development.example`; if it requires a live backend, defer UI to a second PR and submit package + server first. |
| `fallow` flags new package as unused export | Add explicit exports and a consumer (server route) before the first commit. |
| Server route type inference overflows (existing `Hono` TS2589) | Type the route factory with a narrower `Env` or cast the `Hono` app return type; run `bunx tsc --noEmit` in `apps/server` to confirm. |
| No Hyprland on CI / reviewers' machines | Tests mock `hyprctl`; runtime guards return `available: false`. |

## Post-submittal roadmap

After the first PR is open, continue in the fork:

1. `GET /api/desktop/workspaces` and `/api/desktop/active-window`.
2. `POST /api/desktop/reload` (Hyprland config reload), `POST /api/desktop/dispatch` (key dispatcher).
3. Read/ write Omarchy config under `~/.config/hypr/*.lua` (read-only first; reload after mutation).
4. Browser-level integration: expose desktop state to the AI agent loop as MCP tools (`get_monitors`, `switch_workspace`).
5. Upstream follow-up PRs for each generic abstraction as they stabilize.
