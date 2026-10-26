/**
 * `designLoop` against a stub brain — no network, no engine, no UI.
 *
 * These are the gates from `porting/01-orchestration/README.md` §1.6. Each test
 * pins one failure path that the real loop must reproduce from
 * `re/full-reverse/01-generator-loop/REPORT.md` §2.
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_BUILD_RETRIES, MAX_TRANSPORT_RETRIES } from '@/lib/generator/budget'
import { extractSpec } from '@/lib/generator/extract'
import { designLoop, droppedConnection, isDone } from '@/lib/generator/loop'
import type {
  Brain,
  BrainRequest,
  BuildResult,
  LoopOptions,
  ReviewParts
} from '@/lib/generator/types'

const BRAIN: Brain = { id: 'claude' }

/** A brain that replays `replies` in order and records what it was asked. */
function stubBrain(replies: string[], calls: BrainRequest[] = []) {
  return {
    askBrain: async (request: BrainRequest) => {
      calls.push(request)
      const reply = replies.shift()
      if (reply === undefined) throw new Error('stub brain ran out of replies')
      return reply
    },
    calls
  }
}

/** A brain whose first `n` turns fail with a retryable transport error. */
function flakyBrain(failures: number, then: string[], calls: BrainRequest[] = []) {
  let done = 0
  return {
    askBrain: async (request: BrainRequest) => {
      calls.push(request)
      if (done < failures) {
        done++
        throw new Error('connection reset by peer')
      }
      const reply = then.shift()
      if (reply === undefined) throw new Error('stub brain ran out of replies')
      return reply
    },
    calls
  }
}

const okBuilt = (spec: unknown): BuildResult => ({
  spec,
  report: { ok: true, issues: [] }
})

const review: LoopOptions['review'] = (): ReviewParts => ({ lead: 'L', facts: 'F' })

function baseOptions(overrides: Partial<LoopOptions> = {}): LoopOptions {
  const { askBrain } = stubBrain([])
  return {
    action: 'stub',
    system: 'S',
    first: { text: 'make a thing' },
    prompt: 'make a thing',
    brain: BRAIN,
    askBrain,
    brainTakesImages: async () => true,
    build: async (spec) => okBuilt(spec),
    review,
    ...overrides
  }
}

describe('designLoop', () => {
  it('retries a rejected spec and accepts DONE', async () => {
    const { askBrain, calls } = stubBrain([
      '```json\n{"a":1}\n```', // designing
      '```json\n{"a":2}\n```', // fixing (first build threw)
      'DONE' //                  checking
    ])

    const out = await designLoop(
      baseOptions({
        askBrain,
        build: async (spec) => {
          if ((spec as { a: number }).a !== 2) {
            throw Object.assign(new Error('bad'), { problems: ['a must be 2'] })
          }
          return okBuilt(spec)
        }
      })
    )

    expect(out.result).toEqual({ a: 2 })
    expect(out.notes).toContain('fixed 1 design problem(s)')
    expect(calls).toHaveLength(3)
  })

  it('gives up after MAX_BUILD_RETRIES and quotes the first 5 problems', async () => {
    const designing = `\`\`\`json\n${JSON.stringify({ a: 0 })}\n\`\`\``
    const { askBrain, calls } = stubBrain([designing, designing, designing, designing, designing])

    const error = await designLoop(
      baseOptions({
        askBrain,
        build: async () => {
          throw Object.assign(new Error('nope'), {
            problems: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
          })
        }
      })
    ).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("The AI's design could not be built:")
    expect((error as Error).message).toContain('p5')
    expect((error as Error).message).not.toContain('p6')
    // 1 authored attempt + MAX_BUILD_RETRIES fix turns
    expect(calls).toHaveLength(MAX_BUILD_RETRIES + 1)
  })

  it('rejects DONE when report.ok is false and keeps fixing', async () => {
    const { askBrain, calls } = stubBrain([
      '```json\n{"v":1}\n```', // designing → builds, report not ok
      'DONE', //                  checking → rejected, checks still find errors
      'DONE', //                  checking again → re-asked
      'DONE' //                   checking again → accepted (budget spent)
    ])

    const out = await designLoop(
      baseOptions({
        askBrain,
        build: async (spec) => ({
          spec,
          report: { ok: false, issues: [{ level: 'error', message: 'a gap' }] }
        }),
        rounds: 1
      })
    )

    expect(out.notes.some((note) => note.includes('DONE not accepted'))).toBe(true)
    // designing + three checking turns
    expect(calls).toHaveLength(4)
  })

  it('lets a custom accept() gate reject DONE and force another round', async () => {
    const { askBrain, calls } = stubBrain([
      '```json\n{"v":1}\n```', // designing
      'DONE', //                  checking, gate rejects
      '```json\n{"v":2}\n```' //  checking again, returns a revision
    ])

    const accept = vi.fn(() => 'score too low, try again')

    const out = await designLoop(
      baseOptions({
        askBrain,
        accept,
        build: async (spec) => okBuilt(spec),
        rounds: 1
      })
    )

    expect(accept).toHaveBeenCalledTimes(1)
    expect(out.notes).toContain('review 1: DONE not accepted')
    expect(out.result).toEqual({ v: 2 })
    expect(calls).toHaveLength(3)
  })

  it('accepts DONE without a gate when the report is ok', async () => {
    const { askBrain } = stubBrain(['```json\n{"v":1}\n```', 'DONE'])

    const out = await designLoop(baseOptions({ askBrain, build: async (spec) => okBuilt(spec) }))

    expect(out.result).toEqual({ v: 1 })
    expect(out.notes).toHaveLength(0)
  })

  it('retries the round text-only when the brain refuses the image', async () => {
    const calls: BrainRequest[] = []
    const queued = ['```json\n{"v":1}\n```', 'DONE']

    const refusing = async (request: BrainRequest) => {
      calls.push(request)
      const last = request.history[request.history.length - 1]
      if (last?.image) throw new Error('this model does not accept images')
      const reply = queued.shift()
      if (reply === undefined) throw new Error('stub brain ran out of replies')
      return reply
    }

    const out = await designLoop(
      baseOptions({
        askBrain: refusing,
        build: async (spec) => ({ ...okBuilt(spec), sheet: 'data:image/png;base64,AAA' }),
        rounds: 1
      })
    )

    expect(out.notes).toContain('reviewed without pictures (the brain refused the image)')
    expect(out.result).toEqual({ v: 1 })
    // designing + rejected image + text-only retry
    expect(calls).toHaveLength(3)
  })

  it('retries a dropped connection and gives up at MAX_TRANSPORT_RETRIES', async () => {
    const ok = await designLoop(
      baseOptions({
        ...(() => {
          const { askBrain } = flakyBrain(MAX_TRANSPORT_RETRIES, ['```json\n{"v":1}\n```', 'DONE'])
          return { askBrain }
        })()
      })
    )
    expect(ok.result).toEqual({ v: 1 })

    const { askBrain: alwaysFlaky } = flakyBrain(MAX_TRANSPORT_RETRIES + 1, ['unused'])
    const error = await designLoop(baseOptions({ askBrain: alwaysFlaky })).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('connection reset')
  })

  it('never retries an abort', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    let attempts = 0
    const askBrain = async () => {
      attempts++
      throw abort
    }

    const error = await designLoop(baseOptions({ askBrain })).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(attempts).toBe(1)
  })

  it('reports stages in order', async () => {
    const { askBrain } = stubBrain(['```json\n{"v":1}\n```', 'DONE'])
    const stages: string[] = []

    await designLoop(
      baseOptions({
        askBrain,
        onStage: (state) => stages.push(state.stage)
      })
    )

    expect(stages[0]).toBe('designing')
    expect(stages).toContain('building')
    expect(stages).toContain('checking')
  })

  it('sends the engine action on the first turn only', async () => {
    const { askBrain, calls } = stubBrain(['```json\n{"v":1}\n```', 'DONE'])

    await designLoop(baseOptions({ askBrain, action: 'clothing' }))

    expect(calls[0].action).toBe('clothing')
    expect(calls[1].action).toBeUndefined()
  })

  it('re-asks when the reply has no JSON, then throws after the budget', async () => {
    const { askBrain } = stubBrain(['no json here', 'still nothing', 'nope', 'nada'])

    const error = await designLoop(baseOptions({ askBrain })).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('could not be built')
  })
})

describe('extractSpec', () => {
  it('reads a ```json fence', () => {
    expect(extractSpec('here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 })
  })

  it('reads a bare fence', () => {
    expect(extractSpec('```\n{"a":2}\n```')).toEqual({ a: 2 })
  })

  it('falls back to the brace span', () => {
    expect(extractSpec('spec is {"a":3} ok')).toEqual({ a: 3 })
  })

  it('prefers the fence over the brace span', () => {
    expect(extractSpec('{"wrong":true}\n```json\n{"right":true}\n```')).toEqual({
      right: true
    })
  })

  it('returns null for garbage', () => {
    expect(extractSpec('no json at all')).toBeNull()
    expect(extractSpec('')).toBeNull()
    expect(extractSpec('{broken')).toBeNull()
  })
})

describe('isDone', () => {
  it('accepts DONE at either end', () => {
    expect(isDone('DONE')).toBe(true)
    expect(isDone('  done  ')).toBe(true)
    expect(isDone('all good, DONE')).toBe(true)
    expect(isDone('DONE.')).toBe(true)
  })

  it('matches a leading DONE even with trailing prose, as the original does', () => {
    expect(isDone('DONE and then some more text')).toBe(true)
  })

  it('rejects anything that does not contain the token', () => {
    expect(isDone('not done')).toBe(false)
    expect(isDone('')).toBe(false)
  })
})

describe('droppedConnection', () => {
  it('retries transport-shaped errors', () => {
    expect(droppedConnection(new Error('connection reset'))).toBe(true)
    expect(droppedConnection(new Error('socket hang up'))).toBe(true)
    expect(droppedConnection(new Error('timed out'))).toBe(true)
    expect(droppedConnection({ kind: 'exited' })).toBe(true)
    expect(droppedConnection({ stalled: true })).toBe(true)
  })

  it('does not retry validation errors', () => {
    expect(droppedConnection(new Error('a must be 2'))).toBe(false)
    expect(droppedConnection({ problems: ['bad'] })).toBe(false)
  })
})
