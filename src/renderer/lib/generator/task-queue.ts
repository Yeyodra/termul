/**
 * The background job runner a generator runs inside.
 *
 * Generation takes minutes, so the MCP tool returns a `task_id` immediately and
 * the agent polls for the result. Ported from `tasks-Rr6W1sdh.js` — see
 * `re/full-reverse/01-generator-loop/REPORT.md` §16.2.
 *
 * Two invariants are load-bearing:
 *  - concurrency is clamped to `1..4`, default `2` (`tasks:20`, `:41-43`)
 *  - a `queued` or `running` task that is reloaded becomes `interrupted`, never
 *    silently resumed (`tasks:124-130`)
 */
import { MAX_FINISHED_TASKS, TASK_CONCURRENCY, TASK_RESULT_CAP } from './budget'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'

/** The record the UI and the poller both read (`tasks:250-265`). */
export interface TaskRecord {
  id: string
  kind: string
  title: string
  /** What the caller asked for; the handler reads it instead of closing over it. */
  params?: unknown
  status: TaskStatus
  /** Human-readable progress, e.g. `designing`. */
  stage: string
  detail: string | null
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  result: unknown
  error: string | null
}

/** What a running handler may call. */
export interface TaskHandle {
  signal: AbortSignal
  /** Report progress; the queue throttles the UI update. */
  report: (stage: string, detail?: string | null) => void
  task: TaskRecord
}

/** A registered kind. The queue knows nothing about what it produces. */
export type TaskHandler<T = unknown> = (handle: TaskHandle) => Promise<T>

export interface TaskQueueOptions {
  /** Defaults to `TASK_CONCURRENCY`; clamped to `1..4`. */
  concurrency?: number
  /** Fired on every observable change, already throttled. */
  onChange?: (tasks: TaskRecord[]) => void
  /** Fired once when a task settles, whatever the outcome. */
  onFinished?: (task: TaskRecord) => void
  /** Clock override; tests use it to keep ids deterministic. */
  now?: () => number
}

export interface SpawnOptions {
  kind: string
  title: string
  params?: unknown
}

/** Clamp a requested concurrency into the range the original allows. */
export function clampConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) return TASK_CONCURRENCY
  const rounded = Math.floor(value as number)
  if (rounded < 1) return 1
  if (rounded > 4) return 4
  return rounded
}

/** Truncate a result the way the task log does, keeping the notice. */
export function truncateResult(result: unknown): unknown {
  if (typeof result !== 'string') return result
  if (result.length <= TASK_RESULT_CAP) return result
  const cut = result.length - TASK_RESULT_CAP
  return `${result.slice(0, TASK_RESULT_CAP)}\n\n… (cut ${cut} characters)`
}

let counter = 0

function nextId(now: number): string {
  counter += 1
  return `task-${now.toString(36)}-${counter.toString(36)}`
}

export class TaskQueue {
  private tasks: TaskRecord[] = []
  private readonly handlers = new Map<string, TaskHandler>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly running = new Set<string>()
  private readonly concurrency: number
  private readonly options: TaskQueueOptions
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: TaskQueueOptions = {}) {
    this.options = options
    this.concurrency = clampConcurrency(options.concurrency)
  }

  /** Register what a `kind` does. Re-registering replaces it. */
  register<T>(kind: string, handler: TaskHandler<T>): void {
    this.handlers.set(kind, handler as TaskHandler)
  }

  hasHandler(kind: string): boolean {
    return this.handlers.has(kind)
  }

  /** Every task, newest first. */
  list(): TaskRecord[] {
    return this.tasks.map((task) => ({ ...task }))
  }

  get(id: string): TaskRecord | null {
    const found = this.tasks.find((task) => task.id === id)
    return found ? { ...found } : null
  }

  /** Queue a task and return its record; the handler starts when a slot frees. */
  spawn({ kind, title, params }: SpawnOptions): TaskRecord {
    const now = this.clock()
    const task: TaskRecord = {
      id: nextId(now),
      kind,
      title,
      params,
      status: 'queued',
      stage: 'Waiting',
      detail: null,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      result: null,
      error: null
    }
    this.tasks.unshift(task)
    this.emit()
    this.pump()
    return { ...task }
  }

  /** Cancel a queued or running task. A settled task is left alone. */
  cancel(id: string): boolean {
    const task = this.tasks.find((entry) => entry.id === id)
    if (!task) return false
    if (task.status === 'queued') {
      task.status = 'cancelled'
      task.endedAt = this.clock()
      this.emit()
      this.options.onFinished?.({ ...task })
      return true
    }
    if (task.status !== 'running') return false
    this.controllers.get(id)?.abort()
    return true
  }

  /** Abort everything; used on project switch and on teardown. */
  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
  }

  /**
   * Replace the in-memory list from persisted state.
   *
   * A task that was `queued` or `running` when the app died cannot be resumed —
   * its handler closure is gone — so it is marked `interrupted`. That is the
   * difference between an honest "this stopped" and a task that sits at
   * "running" forever.
   */
  restore(tasks: TaskRecord[]): void {
    this.tasks = tasks.map((task) => {
      if (task.status === 'queued' || task.status === 'running') {
        return { ...task, status: 'interrupted' as const, detail: 'Interrupted by a restart' }
      }
      return { ...task }
    })
    this.prune()
    this.emit()
  }

  /** Persistable snapshot: finished tasks capped, live ones kept. */
  snapshot(): TaskRecord[] {
    return this.tasks.map((task) => ({ ...task }))
  }

  /** Wait for every queued and running task to settle. Tests use it. */
  async drain(): Promise<void> {
    while (this.tasks.some((task) => task.status === 'queued' || task.status === 'running')) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private clock(): number {
    return this.options.now?.() ?? Date.now()
  }

  private prune(): void {
    const finished = this.tasks.filter(
      (task) => task.status === 'done' || task.status === 'failed' || task.status === 'cancelled'
    )
    if (finished.length <= MAX_FINISHED_TASKS) return
    const drop = new Set(finished.slice(MAX_FINISHED_TASKS).map((task) => task.id))
    this.tasks = this.tasks.filter((task) => !drop.has(task.id))
  }

  private pump(): void {
    while (this.running.size < this.concurrency) {
      const next = this.tasks.find((task) => task.status === 'queued' && !this.running.has(task.id))
      if (!next) return
      void this.run(next)
    }
  }

  private async run(task: TaskRecord): Promise<void> {
    const handler = this.handlers.get(task.kind)
    this.running.add(task.id)

    if (!handler) {
      this.settle(task, 'failed', null, `No handler registered for "${task.kind}"`)
      return
    }

    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    task.status = 'running'
    task.stage = 'Starting'
    task.startedAt = this.clock()
    this.emit()

    let lastEmit = 0
    const report = (stage: string, detail?: string | null) => {
      task.stage = stage
      task.detail = detail ?? null
      const now = this.clock()
      if (now - lastEmit >= 1000) {
        lastEmit = now
        this.emit()
      }
    }

    try {
      const result = await handler({ signal: controller.signal, report, task })
      if (controller.signal.aborted) {
        this.settle(task, 'cancelled', null, null)
      } else {
        this.settle(task, 'done', truncateResult(result), null)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.settle(task, 'cancelled', null, null)
      } else {
        this.settle(task, 'failed', null, error instanceof Error ? error.message : String(error))
      }
    } finally {
      this.running.delete(task.id)
      this.controllers.delete(task.id)
      this.pump()
    }
  }

  private settle(
    task: TaskRecord,
    status: TaskStatus,
    result: unknown,
    error: string | null
  ): void {
    task.status = status
    task.result = result
    task.error = error
    task.endedAt = this.clock()
    task.stage = status === 'done' ? 'Done' : task.stage
    this.running.delete(task.id)
    this.controllers.delete(task.id)
    this.prune()
    this.emit()
    this.options.onFinished?.({ ...task })
  }

  private emit(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.options.onChange?.(this.list())
    }, 0)
  }
}
