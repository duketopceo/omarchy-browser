/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  CREDENTIAL_FIELDS,
  dbProviderStore,
  type ProviderStore,
} from '../../lib/providers/provider-store'
import { isOmasealRef, storeOmaseal } from '../../lib/secrets/omaseal'
import type { Env } from '../types'

const IdParamSchema = z.object({ providerId: z.string().min(1) })

const SetDefaultSchema = z.object({ providerId: z.string().min(1) })

/**
 * Mirrors the extension's provider config. `id` comes from the client rather
 * than the database so a provider keeps one identity across the extension, the
 * migration and this table, which is what makes re-importing idempotent.
 */
const UpsertProviderSchema = z.object({
  profileId: z.string().nullish(),
  type: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().nullish(),
  modelId: z.string().min(1),
  supportsImages: z.boolean().optional(),
  contextWindow: z.number(),
  temperature: z.number().optional(),
  apiKey: z.string().nullish(),
  accessKeyId: z.string().nullish(),
  secretAccessKey: z.string().nullish(),
  sessionToken: z.string().nullish(),
  resourceName: z.string().nullish(),
  region: z.string().nullish(),
  reasoningEffort: z.string().nullish(),
  reasoningSummary: z.string().nullish(),
  createdAt: z.number().optional(),
  storeInKeyring: z.boolean().optional(),
})

/**
 * Bulk one-time import from extension storage.
 *
 * Insert-if-absent, not upsert: the app writes to this table directly, so a
 * second run must fill gaps without replacing a provider edited since. Each id
 * comes back in exactly one of the two lists so the caller can report what was
 * already present.
 */
const ImportProvidersSchema = z.object({
  providers: z.array(UpsertProviderSchema.extend({ id: z.string().min(1) })),
})

export function createProvidersRoutes(options: { store?: ProviderStore } = {}) {
  const store = options.store ?? dbProviderStore

  return (
    new Hono<Env>()
      .get('/', async (c) => c.json({ providers: await store.list() }))
      // The one selected provider, of any kind. Kept ahead of /:providerId so
      // the literal path is not read as an id.
      .get('/default', async (c) =>
        c.json({ provider: await store.getDefault() }),
      )
      .put('/default', zValidator('json', SetDefaultSchema), async (c) => {
        const updated = await store.setDefault(c.req.valid('json').providerId)
        if (!updated) return c.json({ error: 'Unknown provider' }, 404)
        return c.json({ provider: await store.getDefault() })
      })
      .post('/import', zValidator('json', ImportProvidersSchema), async (c) => {
        const imported: string[] = []
        const skipped: string[] = []
        for (const { storeInKeyring: _, ...provider } of c.req.valid('json')
          .providers) {
          const saved = await store.insertIfAbsent(provider)
          ;(saved ? imported : skipped).push(provider.id)
        }
        return c.json({ imported, skipped })
      })
      .get('/:providerId', zValidator('param', IdParamSchema), async (c) => {
        const provider = await store.get(c.req.valid('param').providerId)
        if (!provider) return c.json({ error: 'Unknown provider' }, 404)
        return c.json({ provider })
      })
      .put(
        '/:providerId',
        zValidator('param', IdParamSchema),
        zValidator('json', UpsertProviderSchema),
        async (c) => {
          const { providerId } = c.req.valid('param')
          const { storeInKeyring, ...rest } = c.req.valid('json')

          if (storeInKeyring) {
            try {
              for (const field of CREDENTIAL_FIELDS) {
                const value = rest[field]
                if (
                  typeof value !== 'string' ||
                  !value ||
                  isOmasealRef(value)
                ) {
                  continue
                }
                rest[field] = await storeOmaseal(
                  'browseros',
                  `${providerId}/${field}`,
                  value,
                )
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error)
              return c.json(
                {
                  error: 'Failed to store credentials in OmaSeal',
                  detail: message,
                },
                503,
              )
            }
          }

          const provider = await store.upsert({ ...rest, id: providerId })
          return c.json({ provider })
        },
      )
      .delete('/:providerId', zValidator('param', IdParamSchema), async (c) => {
        const deleted = await store.remove(c.req.valid('param').providerId)
        if (!deleted) return c.json({ error: 'Unknown provider' }, 404)
        return c.json({ success: true })
      })
  )
}
