/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { HyprlandMonitor } from './types'

function isAvailable() {
  return typeof process.env.HYPRLAND_INSTANCE_SIGNATURE === 'string'
}

export async function getMonitors(): Promise<HyprlandMonitor[]> {
  if (!isAvailable()) {
    return []
  }

  const process = Bun.spawn({
    cmd: ['hyprctl', '-j', 'monitors'],
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const text = await new Response(process.stdout).text()
  const exit = await process.exited
  if (exit !== 0) {
    const error = await new Response(process.stderr).text()
    throw new Error(`hyprctl monitors failed: ${error}`)
  }

  return JSON.parse(text) as HyprlandMonitor[]
}
