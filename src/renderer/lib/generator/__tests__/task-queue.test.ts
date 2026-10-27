/**
 * The background runner: concurrency, cancellation, interruption recovery.
 *
 * These pin the behaviours a generator depends on when its MCP call returns a
 * `task_id` instead of an artifact.
 */
import { describe, expect, it } from 'vitest'
import { MAX_FINISHED_TASKS, TASK_RESULT_CAP } from '@/lib/generator/budget'
import {
  clampConcurrency,
  TaskQueue,
  type TaskRecord,
  truncateResult
} from '@/lib/generator/task-queue'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    kind: 'clothing',
    title: 't',
    status: 'done',
    stage: 'Done',
    detail: null,
    createdAt: 0,
    startedAt: 0,
    endedAt: 0,
    result: null,
    error: null,
    ...overrides
  }
}

describe('clampConcurrency', () => {
  it('defaults to 2', () => {
    expect(clampConcurrency(undefined)).toBe(2)
    expect(clampConcurrency(Number.NaN)).toBe(2)
  })

  it('clamps into 1..4', () => {
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(-5)).toBe(1)
    expect(clampConcurrency(9)).toBe(4)
  })

  it('floors a fractional value', () => {
    expect(clampConcurrency(2.9)).toBe(2)
  })
})

describe('truncateResult', () => {
  it('leaves a short result alone', () => {
    expect(truncateResult('short')).toBe('short')
  })

  it('cuts a long string and says how much was dropped', () => {
    const long = 'x'.repeat(TASK_RESULT_CAP + 10)
    const out = truncateResult(long) as string

    expect(out.length).toBeGreaterThan(TASK_RESULT_CAP)
    expect(out).toContain('… (cut 10 characters)')
    expect(out.startsWith('x'.repeat(TASK_RESULT_CAP))).toBe(true)
  })

  it('passes an object through untouched', () => {
    const value = { a: 1 }
    expect(truncateResult(value)).toBe(value)
  })
})

describe('TaskQueue', () => {
  it('runs two tasks at once by default and queues the third', async () => {
    const queue = new TaskQueue()
    const started: string[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    queue.register('stub', async ({ report }) => {
      started.push('start')
      report('working')
      await gate
      return 'ok'
    })

    queue.spawn({ kind: 'stub', title: 'a' })
    queue.spawn({ kind: 'stub', title: 'b' })
    queue.spawn({ kind: 'stub', title: 'c' })
    await tick()

    expect(started).toHaveLength(2)
    expect(queue.list().filter((task) => task.status === 'queued')).toHaveLength(1)

    release?.()
    await queue.drain()
    expect(started).toHaveLength(3)
  })

  it('honours a concurrency of 1', async () => {
    const queue = new TaskQueue({ concurrency: 1 })
    let active = 0
    let peak = 0

    queue.register('stub', async () => {
      active += 1
      peak = Math.max(peak, active)
      await tick()
      active -= 1
      return 'ok'
    })

    queue.spawn({ kind: 'stub', title: 'a' })
    queue.spawn({ kind: 'stub', title: 'b' })
    await queue.drain()

    expect(peak).toBe(1)
  })

  it('marks a task done and keeps its result', async () => {
    const finished: TaskRecord[] = []
    const queue = new TaskQueue({ onFinished: (task) => finished.push(task) })
    queue.register('stub', async () => 'artifact')

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    expect(queue.get(spawned.id)?.status).not.toBe('done')

    await queue.drain()
    const done = queue.get(spawned.id)

    expect(done?.status).toBe('done')
    expect(done?.result).toBe('artifact')
    expect(finished).toHaveLength(1)
  })

  it('marks a throwing handler failed and keeps the message', async () => {
    const queue = new TaskQueue()
    queue.register('stub', async () => {
      throw new Error('engine exploded')
    })

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    await queue.drain()

    const failed = queue.get(spawned.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('engine exploded')
  })

  it('fails a task whose kind has no handler', async () => {
    const queue = new TaskQueue()
    const spawned = queue.spawn({ kind: 'missing', title: 'a' })
    await queue.drain()

    const failed = queue.get(spawned.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toContain('No handler registered')
  })

  it('cancels a queued task without running it', async () => {
    const queue = new TaskQueue({ concurrency: 1 })
    const ran: string[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    queue.register('stub', async ({ task }) => {
      ran.push(task.id)
      await gate
      return 'ok'
    })

    const first = queue.spawn({ kind: 'stub', title: 'a' })
    const second = queue.spawn({ kind: 'stub', title: 'b' })
    await tick()

    expect(queue.cancel(second.id)).toBe(true)
    release?.()
    await queue.drain()

    expect(queue.get(second.id)?.status).toBe('cancelled')
    expect(ran).toHaveLength(1)
    expect(queue.get(first.id)?.status).toBe('done')
  })

  it('cancels a running task through its abort signal', async () => {
    const queue = new TaskQueue()
    let sawAbort = false

    queue.register('stub', async ({ signal }) => {
      await new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          sawAbort = true
          resolve(null)
        })
      })
      throw new Error('stopped')
    })

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    await tick()
    expect(queue.cancel(spawned.id)).toBe(true)
    await queue.drain()

    expect(sawAbort).toBe(true)
    expect(queue.get(spawned.id)?.status).toBe('cancelled')
  })

  it('refuses to cancel a settled task', async () => {
    const queue = new TaskQueue()
    queue.register('stub', async () => 'ok')

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    await queue.drain()

    expect(queue.cancel(spawned.id)).toBe(false)
  })

  it('turns a queued or running task into interrupted on restore', () => {
    const queue = new TaskQueue()
    queue.restore([
      record({ id: 'a', status: 'queued' }),
      record({ id: 'b', status: 'running' }),
      record({ id: 'c', status: 'done' })
    ])

    expect(queue.get('a')?.status).toBe('interrupted')
    expect(queue.get('b')?.status).toBe('interrupted')
    expect(queue.get('b')?.detail).toBe('Interrupted by a restart')
    expect(queue.get('c')?.status).toBe('done')
  })

  it('keeps at most the finished-task cap', () => {
    const queue = new TaskQueue()
    const many = Array.from({ length: MAX_FINISHED_TASKS + 20 }, (_, index) =>
      record({ id: `task-${index}` })
    )
    queue.restore(many)

    expect(queue.list()).toHaveLength(MAX_FINISHED_TASKS)
  })

  it('reports progress through the throttled stage setter', async () => {
    const stages: string[] = []
    const queue = new TaskQueue()

    queue.register('stub', async ({ report }) => {
      report('designing')
      report('building', 'Building it')
      return 'ok'
    })

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    await queue.drain()

    expect(queue.get(spawned.id)?.status).toBe('done')
    expect(stages).toHaveLength(0)
  })

  it('surfaces the live stage to a listener while the task runs', async () => {
    const seen: string[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const queue = new TaskQueue({
      onChange: (tasks) => seen.push(...tasks.map((task) => task.stage))
    })
    queue.register('stub', async ({ report }) => {
      report('designing')
      await gate
      return 'ok'
    })

    queue.spawn({ kind: 'stub', title: 'a' })
    await tick()
    await tick()

    expect(seen).toContain('designing')

    release?.()
    await queue.drain()
    await tick()
    expect(seen).toContain('Done')
  })

  it('emits a snapshot newest-first', async () => {
    const queue = new TaskQueue()
    queue.register('stub', async () => 'ok')

    const first = queue.spawn({ kind: 'stub', title: 'a' })
    const second = queue.spawn({ kind: 'stub', title: 'b' })
    await queue.drain()

    expect(queue.list()[0].id).toBe(second.id)
    expect(queue.list()[1].id).toBe(first.id)
  })

  it('does not let a listener mutate the queue through a snapshot', async () => {
    const queue = new TaskQueue()
    queue.register('stub', async () => 'ok')

    const spawned = queue.spawn({ kind: 'stub', title: 'a' })
    const snapshot = queue.get(spawned.id)
    if (snapshot) snapshot.status = 'failed'

    expect(queue.get(spawned.id)?.status).not.toBe('failed')
  })

  it('cancelAll aborts every live task', async () => {
    const queue = new TaskQueue()
    const aborted: string[] = []

    queue.register('stub', async ({ signal, task }) => {
      await new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted.push(task.id)
          resolve(null)
        })
      })
      throw new Error('stopped')
    })

    queue.spawn({ kind: 'stub', title: 'a' })
    queue.spawn({ kind: 'stub', title: 'b' })
    await tick()
    queue.cancelAll()
    await queue.drain()

    expect(aborted).toHaveLength(2)
  })
})
