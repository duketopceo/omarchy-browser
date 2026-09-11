/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { resolveLLMConfig } from '../../../../src/lib/clients/llm/config'
import {
  initializeOAuth,
  shutdownOAuth,
} from '../../../../src/lib/clients/oauth'
import { OAuthTokenStore } from '../../../../src/lib/clients/oauth/token-store'
import { closeDb, initializeDb } from '../../../../src/lib/db'

describe('resolveLLMConfig', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    shutdownOAuth()
    closeDb()
    delete process.env.OMASEAL_PATH
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  it('defaults ChatGPT OAuth providers to GPT-5.5', async () => {
    const browserosId = 'browseros-id'
    const dir = mkdtempSync(join(tmpdir(), 'browseros-llm-config-test-'))
    tempDirs.push(dir)
    const handle = initializeDb({
      dbPath: join(dir, 'db', 'browseros.sqlite'),
    })
    initializeOAuth(handle.db, browserosId)
    new OAuthTokenStore(handle.db).upsertTokens(browserosId, 'chatgpt-pro', {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600_000,
      accountId: 'account-id',
    })

    const resolved = await resolveLLMConfig(
      { provider: LLM_PROVIDERS.CHATGPT_PRO },
      browserosId,
    )

    expect(resolved).toMatchObject({
      provider: LLM_PROVIDERS.CHATGPT_PRO,
      model: 'gpt-5.5',
      apiKey: 'access-token',
      upstreamProvider: 'openai',
      accountId: 'account-id',
    })
  })

  it('resolves OmaSeal references for ordinary providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-llm-config-test-'))
    tempDirs.push(dir)

    const scriptPath = join(dir, 'omaseal')
    writeFileSync(
      scriptPath,
      `#!/bin/sh\nif [ "$1" = "resolve" ]; then printf 'resolved-key'; elif [ "$1" = "set" ]; then cat > /dev/null; echo "ok"; fi\n`,
    )
    chmodSync(scriptPath, 0o755)
    process.env.OMASEAL_PATH = scriptPath

    const resolved = await resolveLLMConfig({
      provider: LLM_PROVIDERS.OPENROUTER,
      model: 'openrouter/model',
      apiKey: 'omaseal://browseros/openrouter/apiKey',
      baseUrl: 'https://openrouter.ai/api/v1',
    })

    expect(resolved).toMatchObject({
      provider: LLM_PROVIDERS.OPENROUTER,
      model: 'openrouter/model',
      apiKey: 'resolved-key',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
  })
})
