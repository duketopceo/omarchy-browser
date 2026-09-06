/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getMonitors } from '@browseros/omarchy'
import { Hono } from 'hono'

export function createOmarchyRoutes() {
  return new Hono().get('/monitors', async (c) => {
    const monitors = await getMonitors()
    return c.json({ monitors })
  })
}
