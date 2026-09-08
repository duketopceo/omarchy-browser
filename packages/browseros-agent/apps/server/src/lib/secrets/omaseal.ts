/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OmaSeal keyring integration. Shells out to the `omaseal` CLI, passing secrets
 * on stdin and never in command arguments.
 */

import {
  mergePath,
  resolveLoginShellPath,
} from '../agents/host-acp/resolve-login-path'
import { logger } from '../logger'

const DEFAULT_TIMEOUT_MS = 5_000

export interface OmasealRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface OmasealRunner {
  run(
    command: string,
    args: string[],
    stdin?: string,
    timeoutMs?: number,
  ): Promise<OmasealRunResult>
}

export interface OmasealOptions {
  /** Absolute path to the `omaseal` binary. Auto-detected when omitted. */
  binPath?: string
  /** Per-call timeout. */
  timeoutMs?: number
  /** Test seam. */
  runner?: OmasealRunner
}

const defaultRunner: OmasealRunner = {
  async run(command, args, stdin?, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const proc = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin ? Buffer.from(stdin, 'utf8') : 'ignore',
      env: process.env,
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (timedOut) {
        return { stdout, stderr: stderr || 'timed out', exitCode: 124 }
      }

      return { stdout, stderr, exitCode }
    } catch (error) {
      clearTimeout(timer)
      throw error
    }
  },
}

function resolveBinPath(options?: OmasealOptions): string {
  if (options?.binPath) return options.binPath
  if (process.env.OMASEAL_PATH) return process.env.OMASEAL_PATH

  const which = Bun.which('omaseal')
  if (which) return which

  // GUI-launched servers inherit a short PATH; check the user's login shell too.
  const loginPath = resolveLoginShellPath()
  if (loginPath) {
    const mergedPath = mergePath(loginPath, process.env.PATH ?? '')
    const whichWithLogin = Bun.which('omaseal', { PATH: mergedPath })
    if (whichWithLogin) return whichWithLogin
  }

  if (process.env.HOME) return `${process.env.HOME}/.local/bin/omaseal`
  return 'omaseal'
}

export function parseOmasealRef(
  value: string,
): { service: string; account: string } | null {
  const prefix = 'omaseal://'
  if (!value.startsWith(prefix)) return null
  const rest = value.slice(prefix.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx <= 0 || slashIdx >= rest.length - 1) return null
  const service = rest.slice(0, slashIdx)
  const account = rest.slice(slashIdx + 1)
  return service.length > 0 && account.length > 0 ? { service, account } : null
}

export function isOmasealRef(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith('omaseal://')
}

/**
 * Resolves an `omaseal://<service>/<account>` reference to the stored secret.
 * Returns `null` when the binary is missing, the secret is not found, or the
 * call times out. Never throws.
 */
export async function resolveOmaseal(
  value: string,
  options?: OmasealOptions,
): Promise<string | null> {
  const ref = parseOmasealRef(value)
  if (!ref) return null

  const binPath = resolveBinPath(options)
  const runner = options?.runner ?? defaultRunner
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  logger.debug('[OmaSeal] Resolving reference', {
    rawRef: value,
    service: ref.service,
    account: ref.account,
    binPath,
    timeoutMs,
  })

  try {
    const { stdout, stderr, exitCode } = await runner.run(
      binPath,
      ['resolve', ref.service, ref.account],
      undefined,
      timeoutMs,
    )

    if (exitCode !== 0) {
      logger.debug('[OmaSeal] Keyring resolution failed', {
        service: ref.service,
        account: ref.account,
        exitCode,
        stderr: stderr.trim(),
      })
      return null
    }

    const secret = stdout.trim()
    if (!secret) {
      logger.debug('[OmaSeal] Keyring resolution returned empty payload', {
        service: ref.service,
        account: ref.account,
      })
      return null
    }

    logger.debug('[OmaSeal] Keyring resolution succeeded', {
      service: ref.service,
      account: ref.account,
      secretLength: secret.length,
    })

    return secret
  } catch (error) {
    logger.debug('[OmaSeal] Keyring resolution encountered exception', {
      service: ref.service,
      account: ref.account,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return null
  }
}

/**
 * Stores a secret in OmaSeal and returns the `omaseal://` reference string.
 * Throws when `omaseal set` fails so the caller can surface the error.
 */
export async function storeOmaseal(
  service: string,
  account: string,
  secret: string,
  options?: OmasealOptions,
): Promise<string> {
  if (!service || !account) {
    throw new Error('service and account are required for OmaSeal storage')
  }
  if (secret === '') {
    throw new Error('secret cannot be empty')
  }

  const binPath = resolveBinPath(options)
  const runner = options?.runner ?? defaultRunner
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  logger.debug('[OmaSeal] Storing secret', {
    service,
    account,
    binPath,
    secretLength: secret.length,
    timeoutMs,
  })

  try {
    const { stderr, exitCode } = await runner.run(
      binPath,
      ['set', service, account],
      secret,
      timeoutMs,
    )

    if (exitCode !== 0) {
      logger.debug('[OmaSeal] Keyring store command failed', {
        service,
        account,
        exitCode,
        stderr: stderr.trim(),
      })
      throw new Error(stderr || `omaseal set exited ${exitCode}`)
    }

    logger.debug('[OmaSeal] Secret stored successfully in keyring', {
      service,
      account,
      ref: `omaseal://${service}/${account}`,
    })

    return `omaseal://${service}/${account}`
  } catch (error) {
    logger.warn('[OmaSeal] Keyring store failed', {
      service,
      account,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error instanceof Error ? error : new Error(String(error))
  }
}
