/**
 * The generator pipeline.
 *
 * `designLoop` is the orchestration; the transport (`askBrain`), the background
 * runner (`TaskQueue`), the Roblox context (`sessionContext`) and the engines
 * plug into it. Nothing here imports a concrete transport or a DOM.
 *
 * Reference: `porting/01-orchestration/README.md`,
 * `re/full-reverse/01-generator-loop/REPORT.md` §2, §4, §16.
 */
export * from './ask-brain'
export * from './budget'
export * from './engines/clothing'
export { extractSpec } from './extract'
export { designLoop, droppedConnection, isDone } from './loop'
export * from './session-context'
export * from './task-queue'
export * from './tools/generate-clothing'
export type * from './types'
