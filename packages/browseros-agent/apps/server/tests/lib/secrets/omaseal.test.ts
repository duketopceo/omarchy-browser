import { describe, expect, it } from 'bun:test'
import {
  isOmasealRef,
  type OmasealRunner,
  type OmasealRunResult,
  parseOmasealRef,
  resolveOmaseal,
  storeOmaseal,
} from '../../../src/lib/secrets/omaseal'

function makeRunner(responses: Map<string, OmasealRunResult>): {
  runner: OmasealRunner
  calls: { command: string; args: string[]; stdin?: string }[]
} {
  const calls: { command: string; args: string[]; stdin?: string }[] = []
  const runner: OmasealRunner = {
    async run(command, args, stdin?) {
      calls.push({ command, args, stdin })
      const key = [command, ...args].join(' ')
      const result = responses.get(key)
      if (!result) {
        return { stdout: '', stderr: 'not found', exitCode: 1 }
      }
      return result
    },
  }
  return { runner, calls }
}

describe('parseOmasealRef', () => {
  it('parses a well-formed reference', () => {
    expect(
      parseOmasealRef('omaseal://browseros/openrouter-default/apiKey'),
    ).toEqual({
      service: 'browseros',
      account: 'openrouter-default/apiKey',
    })
  })

  it('parses a reference with an account containing a slash', () => {
    expect(
      parseOmasealRef('omaseal://browseros/openrouter/default/apiKey'),
    ).toEqual({
      service: 'browseros',
      account: 'openrouter/default/apiKey',
    })
  })

  it('returns null for non-reference strings', () => {
    expect(parseOmasealRef('sk-abc123')).toBeNull()
    expect(parseOmasealRef('omaseal:/missing')).toBeNull()
    expect(parseOmasealRef('omaseal:///')).toBeNull()
  })
})

describe('isOmasealRef', () => {
  it('identifies references', () => {
    expect(isOmasealRef('omaseal://browseros/p/apiKey')).toBe(true)
    expect(isOmasealRef(undefined)).toBe(false)
    expect(isOmasealRef('plainkey')).toBe(false)
  })
})

describe('resolveOmaseal', () => {
  it('returns the trimmed secret when the reference resolves', async () => {
    const responses = new Map<string, OmasealRunResult>([
      [
        'omaseal resolve browseros openrouter-default/apiKey',
        { stdout: 'sk-123\n', stderr: '', exitCode: 0 },
      ],
    ])
    const { runner, calls } = makeRunner(responses)

    const result = await resolveOmaseal(
      'omaseal://browseros/openrouter-default/apiKey',
      { runner, binPath: 'omaseal' },
    )

    expect(result).toBe('sk-123')
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('omaseal')
    expect(calls[0].args).toEqual([
      'resolve',
      'browseros',
      'openrouter-default/apiKey',
    ])
  })

  it('returns null for a malformed reference', async () => {
    const { runner, calls } = makeRunner(new Map())
    expect(
      await resolveOmaseal('plainkey', { runner, binPath: 'omaseal' }),
    ).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null when the keyring exits non-zero', async () => {
    const responses = new Map<string, OmasealRunResult>([
      [
        'omaseal resolve browseros openrouter-default/apiKey',
        { stdout: '', stderr: 'not found', exitCode: 1 },
      ],
    ])
    const { runner } = makeRunner(responses)
    expect(
      await resolveOmaseal('omaseal://browseros/openrouter-default/apiKey', {
        runner,
        binPath: 'omaseal',
      }),
    ).toBeNull()
  })

  it('returns null when the runner throws', async () => {
    const runner: OmasealRunner = {
      async run() {
        throw new Error('ENOENT')
      },
    }
    expect(
      await resolveOmaseal('omaseal://browseros/openrouter-default/apiKey', {
        runner,
        binPath: 'omaseal',
      }),
    ).toBeNull()
  })
})

describe('storeOmaseal', () => {
  it('stores a secret and returns a reference', async () => {
    const responses = new Map<string, OmasealRunResult>([
      [
        'omaseal set browseros openrouter-default/apiKey',
        { stdout: 'ok\n', stderr: '', exitCode: 0 },
      ],
    ])
    const { runner, calls } = makeRunner(responses)

    const ref = await storeOmaseal(
      'browseros',
      'openrouter-default/apiKey',
      'sk-123',
      { runner, binPath: 'omaseal' },
    )

    expect(ref).toBe('omaseal://browseros/openrouter-default/apiKey')
    expect(calls).toHaveLength(1)
    expect(calls[0].stdin).toBe('sk-123')
    expect(calls[0].args).toEqual([
      'set',
      'browseros',
      'openrouter-default/apiKey',
    ])
  })

  it('rejects an empty secret', async () => {
    const { runner } = makeRunner(new Map())
    await expect(
      storeOmaseal('browseros', 'x', '', { runner, binPath: 'omaseal' }),
    ).rejects.toThrow('secret cannot be empty')
  })

  it('throws when omaseal set fails', async () => {
    const responses = new Map<string, OmasealRunResult>([
      [
        'omaseal set browseros openrouter-default/apiKey',
        { stdout: '', stderr: 'locked', exitCode: 1 },
      ],
    ])
    const { runner } = makeRunner(responses)
    await expect(
      storeOmaseal('browseros', 'openrouter-default/apiKey', 'sk-123', {
        runner,
        binPath: 'omaseal',
      }),
    ).rejects.toThrow('locked')
  })
})
