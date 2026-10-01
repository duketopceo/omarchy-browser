# cdp-shim — stock-Chromium compatibility for browseros-claw-server

A ~450-line Node websocket proxy that sits between `browseros-claw-server`
and an unmodified Chromium (`--remote-debugging-port`). Neo's server expects
the forked BrowserOS CDP surface (`Browser.getTabs`/`createTab` with numeric
`tabId`s, `isHidden`, browser-level `Browser.*` commands); stock Chromium
speaks `Target.*` with hex target ids. The shim translates, so the full agent
pipeline works without the fork.

## Usage

```bash
chromium --headless --remote-debugging-port=49337 \
  --user-data-dir=/path/to/profile \
  --disable-extensions-except=/path/to/browserclaw-extension \
  --load-extension=/path/to/browserclaw-extension

node cdp-shim.js   # listens :49338, proxies to :49337
browseros-claw-server --config sidecar.json   # pointed at :49338
```

Verified end-to-end on Linux arm64 (Asahi/Omarchy): `initialize`, tab seeding,
`tabs list/new`, navigation, and page-content reads against an external site.

## What it fixes vs a naive proxy

- **Queued passthrough sends** — a `send()` on a still-CONNECTING upstream
  websocket throws `InvalidStateError` and silently drops the request; the
  server then hangs in `wait_for_initial_attempt`. Sends are queued until
  upstream `open`.
- **Numeric tabIds** — the server's serde expects `i64` `tabId`; Chromium's
  hex `targetId`s fail to deserialize. The shim maps `tabId ↔ targetId`
  stably and resolves both forms on `getTabInfo`/`closeTab`/`moveTab`.
- **`isHidden` in `TabInfo`** — required by the fork's protocol; synthesized
  (`false`) for stock targets.
- **`Browser.getTabs` / `createTab` / `closeTab` / `activateTab`** — emulated
  over `Target.getTargets` / `createTarget` / `closeTarget` /
  `activateTarget`; per-target `Target.attachToTarget` sessions are tracked
  so `Runtime`/`Page`/`Network` domains on a page session pass through.

## Deployment gotcha observed on Omarchy/Arch

Some distros force-install extensions into every profile via
`/usr/share/chromium/extensions/*.json`. On a fresh headless profile, a
force-installed password-manager extension deadlocks navigation entirely
(`Target.createTarget` returns, renderer stays `about:blank`,
`Page.navigate` never answers — looks like dead networking but isn't).
`--disable-extensions-except=<browserclaw ext>` avoids it.

## Status

Local working artifact from the Omarchy sidecar deployment
(`~/.local/share/browserclaw/`). Candidate for upstream once
browseros-ai/BrowserOS#2794 (linux-arm64 lane) gets maintainer direction.
