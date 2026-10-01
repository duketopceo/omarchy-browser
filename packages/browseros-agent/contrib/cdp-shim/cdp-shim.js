#!/usr/bin/env bun
/**
 * CDP Shim / Protocol Adapter for BrowserOS
 * Translates proprietary Browser.* CDP methods (Browser.getTabs, Browser.createTab, etc.)
 * into standard Chrome DevTools Protocol Target.* methods for Chromium.
 */

const TARGET_PORT = parseInt(process.env.CHROMIUM_CDP_PORT || "9108", 10);
const SHIM_PORT = parseInt(process.env.SHIM_CDP_PORT || "9107", 10);

console.log(`[cdp-shim] Starting CDP Translation Shim on port ${SHIM_PORT} -> Chromium on port ${TARGET_PORT}`);

// Active tab and window tracking
let activeTargetId = null;

// BrowserOS expects numeric i64 tabIds; Chromium emits hex targetIds.
// Keep a stable bidirectional mapping for the shim's lifetime.
const tabIdByTarget = new Map();
const targetByTabId = new Map();
let nextTabId = 1;

function tabIdFor(targetId) {
  let id = tabIdByTarget.get(targetId);
  if (id === undefined) {
    id = nextTabId++;
    tabIdByTarget.set(targetId, id);
    targetByTabId.set(id, targetId);
  }
  return id;
}

function resolveTargetId(idLike) {
  if (typeof idLike === "number") return targetByTabId.get(idLike) || null;
  if (typeof idLike === "string") {
    if (/^\d+$/.test(idLike)) {
      const mapped = targetByTabId.get(parseInt(idLike, 10));
      if (mapped) return mapped;
    }
    return idLike; // already a targetId
  }
  return null;
}

async function getChromiumTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${TARGET_PORT}/json/list`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

function targetToTab(target, index = 0) {
  const tid = target.id || target.targetId;
  return {
    targetId: tid,
    tabId: tabIdFor(tid),
    url: target.url || "",
    title: target.title || "",
    isActive: tid === activeTargetId,
    isLoading: false,
    loadProgress: 1,
    isPinned: false,
    isHidden: false,
    windowId: 1,
    index: index,
    groupId: undefined
  };
}


// browserclaw hardening: async handlers race client disconnects; never let
// a send-on-closed socket kill the shim.
process.on("uncaughtException", (e) => console.error("[cdp-shim] swallowed:", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[cdp-shim] rejection:", e?.message || e));

const server = Bun.serve({
  port: SHIM_PORT,
  hostname: "127.0.0.1",
  async fetch(req, srv) {
    const url = new URL(req.url);

    // Upgrade WebSockets
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const targetWsUrl = `ws://127.0.0.1:${TARGET_PORT}${url.pathname}${url.search}`;
      let upstreamWs;
      try {
        upstreamWs = new WebSocket(targetWsUrl);
      } catch (err) {
        return new Response("Upstream CDP connection error", { status: 502 });
      }

      const upgraded = srv.upgrade(req, {
        data: {
          upstreamWs,
          pending: new Map(),
          idCounter: 900000
        }
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // BrowserOS native dialog API for choosing workspace directories or files
    if (url.pathname === "/api/choose-path") {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      try {
        let defaultPath = process.env.HOME || "/tmp";
        let title = "Select Workspace Folder";
        let type = "folder";
        let directPath = null;

        if (req.method === "POST") {
          try {
            const body = await req.json();
            if (body.path) directPath = body.path;
            if (body.defaultPath) defaultPath = body.defaultPath;
            if (body.title) title = body.title;
            if (body.type) type = body.type;
          } catch {}
        } else if (req.method === "GET") {
          if (url.searchParams.get("path")) directPath = url.searchParams.get("path");
          if (url.searchParams.get("defaultPath")) defaultPath = url.searchParams.get("defaultPath");
          if (url.searchParams.get("title")) title = url.searchParams.get("title");
          if (url.searchParams.get("type")) type = url.searchParams.get("type");
        }

        if (directPath) {
          const trimmed = directPath.trim();
          const name = trimmed.split("/").filter(Boolean).pop() || trimmed;
          return new Response(JSON.stringify({ ok: true, path: trimmed, name }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const args = ["zenity", "--file-selection"];
        if (type === "folder") {
          args.push("--directory");
        }
        args.push(`--title=${title}`);
        args.push(`--filename=${defaultPath.replace(/\/+$/, "")}/`);

        const proc = Bun.spawn(args, {
          env: {
            ...process.env,
            WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-1",
            DISPLAY: process.env.DISPLAY || ":0",
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1001"
          }
        });

        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        if (exitCode === 0 && output.trim()) {
          const selectedPath = output.trim();
          const name = selectedPath.split("/").filter(Boolean).pop() || selectedPath;
          return new Response(JSON.stringify({ ok: true, path: selectedPath, name }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          return new Response(JSON.stringify({ ok: false, cancelled: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // HTTP Endpoints (e.g. /json/version, /json/list)
    try {
      const upstreamRes = await fetch(`http://127.0.0.1:${TARGET_PORT}${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers
      });
      let body = await upstreamRes.text();

      // If /json/version or /json/list, replace target port with shim port
      if (url.pathname.startsWith("/json")) {
        body = body.replaceAll(`:${TARGET_PORT}`, `:${SHIM_PORT}`);
      }

      return new Response(body, {
        status: upstreamRes.status,
        headers: upstreamRes.headers
      });
    } catch (err) {
      return new Response(`CDP Proxy error: ${err.message}`, { status: 502 });
    }
  },

  websocket: {
    open(ws) {
      const { upstreamWs } = ws.data;

      upstreamWs.onopen = () => {
        // Connected to Chromium
      };

      upstreamWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Check if it's a response to a translated internal request
          if (msg.id && ws.data.pending.has(msg.id)) {
            const cb = ws.data.pending.get(msg.id);
            ws.data.pending.delete(msg.id);
            cb(msg);
            return;
          }
        } catch {}
        // Forward normal messages to client
        try {
          ws.send(event.data);
        } catch {}
      };

      upstreamWs.onerror = (err) => {
        console.error("[cdp-shim] Upstream WS error:", err.message);
      };

      upstreamWs.onclose = () => {
        try { ws.close(); } catch {}
      };
    },

    async message(ws, message) {
      const { upstreamWs, pending } = ws.data;
      let text = typeof message === "string" ? message : new TextDecoder().decode(message);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        passthroughUpstream();
        return;
      }

      const id = msg.id;
      const method = msg.method;
      if (method) console.log("[cdp-shim] ->", method, "id=" + id);
      const params = msg.params || {};

      // Passthrough that survives the upstream socket still connecting:
      // a send() on a CONNECTING ws throws InvalidStateError and the client
      // request is dropped with no response. Queue until open instead.
      const passthroughUpstream = () => {
        if (upstreamWs.readyState === WebSocket.OPEN) {
          try { upstreamWs.send(message); } catch {}
        } else {
          upstreamWs.addEventListener("open", () => {
            try { upstreamWs.send(message); } catch {}
          }, { once: true });
        }
      };

      // Helper to send query to upstream Chromium CDP
      const sendUpstream = (reqMethod, reqParams = {}) => {
        return new Promise((resolve) => {
          const reqId = ++ws.data.idCounter;
          pending.set(reqId, resolve);
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(JSON.stringify({ id: reqId, method: reqMethod, params: reqParams }));
          } else {
            upstreamWs.addEventListener("open", () => {
              upstreamWs.send(JSON.stringify({ id: reqId, method: reqMethod, params: reqParams }));
            }, { once: true });
          }
        });
      };

      // Handle proprietary Browser.* methods
      if (method === "Browser.getTabs") {
        const targets = await getChromiumTargets();
        const pages = targets.filter(t => t.type === "page");
        if (pages.length > 0 && !activeTargetId) {
          activeTargetId = pages[0].id;
        }
        const tabs = pages.map((p, idx) => targetToTab(p, idx));
        ws.send(JSON.stringify({
          id,
          result: { tabs }
        }));
        return;
      }

      if (method === "Browser.getActiveTab") {
        const targets = await getChromiumTargets();
        const pages = targets.filter(t => t.type === "page");
        const active = pages.find(p => p.id === activeTargetId) || pages[0];
        ws.send(JSON.stringify({
          id,
          result: {
            tab: active ? targetToTab(active, 0) : null
          }
        }));
        return;
      }

      if (method === "Browser.getTabInfo") {
        const tabId = resolveTargetId(params.tabId) || params.targetId;
        const targets = await getChromiumTargets();
        const page = targets.find(p => (p.id === tabId || p.targetId === tabId));
        if (page) {
          ws.send(JSON.stringify({
            id,
            result: { tab: targetToTab(page) }
          }));
        } else {
          ws.send(JSON.stringify({
            id,
            error: { code: -32000, message: `Tab ${tabId} not found` }
          }));
        }
        return;
      }

      if (method === "Browser.createTab") {
        const res = await sendUpstream("Target.createTarget", {
          url: params.url || "about:blank"
        });
        if (res.result?.targetId) {
          const targetId = res.result.targetId;
          activeTargetId = targetId;
          const tab = {
            targetId,
            tabId: tabIdFor(targetId),
            url: params.url || "about:blank",
            title: "",
            isActive: true,
            isLoading: false,
            loadProgress: 1,
            isPinned: false,
            isHidden: false,
            windowId: 1,
            index: 0
          };
          ws.send(JSON.stringify({
            id,
            result: { tab }
          }));
        } else {
          ws.send(JSON.stringify({
            id,
            error: res.error || { code: -32000, message: "Failed to create tab" }
          }));
        }
        return;
      }

      if (method === "Browser.closeTab") {
        const targetId = resolveTargetId(params.tabId) || params.targetId;
        const res = await sendUpstream("Target.closeTarget", { targetId });
        ws.send(JSON.stringify({
          id,
          result: { success: res.result?.success ?? true }
        }));
        return;
      }

      if (method === "Browser.moveTab") {
        const targetId = resolveTargetId(params.tabId) || params.targetId;
        const targets = await getChromiumTargets();
        const page = targets.find(p => (p.id === targetId || p.targetId === targetId));
        ws.send(JSON.stringify({
          id,
          result: { tab: page ? targetToTab(page, params.index || 0) : null }
        }));
        return;
      }

      if (method === "Browser.getWindows") {
        ws.send(JSON.stringify({
          id,
          result: {
            windows: [{
              windowId: 1,
              windowType: "normal",
              tabCount: (await getChromiumTargets()).filter(t => t.type === "page").length,
              isActive: true,
              isVisible: true
            }]
          }
        }));
        return;
      }

      if (method === "Browser.createWindow") {
        ws.send(JSON.stringify({
          id,
          result: {
            window: {
              windowId: 1,
              windowType: "normal",
              tabCount: 1,
              isActive: true,
              isVisible: true
            }
          }
        }));
        return;
      }

      if (method === "Browser.closeWindow" || method === "Browser.activateWindow") {
        ws.send(JSON.stringify({
          id,
          result: {}
        }));
        return;
      }

      if (method === "Browser.getTabGroups") {
        ws.send(JSON.stringify({
          id,
          result: { groups: [] }
        }));
        return;
      }

      if (method === "Browser.createTabGroup" || method === "Browser.updateTabGroup") {
        ws.send(JSON.stringify({
          id,
          result: { group: { groupId: params.groupId || "group-1", title: params.title || "Group", color: "blue", collapsed: false } }
        }));
        return;
      }

      if (method === "Browser.addTabsToGroup" || method === "Browser.removeTabsFromGroup" || method === "Browser.closeTabGroup") {
        ws.send(JSON.stringify({
          id,
          result: {}
        }));
        return;
      }

      // Default: forward message directly to upstream Chromium CDP
      passthroughUpstream();
    },

    close(ws) {
      const { upstreamWs } = ws.data;
      try { upstreamWs.close(); } catch {}
    }
  }
});
