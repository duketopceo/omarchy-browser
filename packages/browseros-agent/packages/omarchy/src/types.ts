/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface HyprlandWorkspace {
  id: number
  name: string
}

export interface HyprlandMonitor {
  id: number
  name: string
  description: string
  make: string
  model: string
  serial: string
  width: number
  height: number
  physicalWidth: number
  physicalHeight: number
  refreshRate: number
  x: number
  y: number
  activeWorkspace: HyprlandWorkspace
  specialWorkspace: HyprlandWorkspace
  reserved: [number, number, number, number]
  scale: number
  transform: number
  focused: boolean
  dpmsStatus: boolean
  vrr: boolean
  disabled: boolean
  currentFormat: string
  mirrorOf: string
  availableModes: string[]
  colorManagementPreset: string
  sdrBrightness: number
  sdrSaturation: number
  sdrMinLuminance: number
  sdrMaxLuminance: number
  hardwareCursorsInUse: boolean
}

export interface OmarchyDisplays {
  monitors: HyprlandMonitor[]
}
