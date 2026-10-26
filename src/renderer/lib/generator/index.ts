/**
 * The generator loop (`designLoop`) — porting step `01`.
 *
 * Pure orchestration: no engine, no transport, no UI. Engines arrive in step
 * `03`; the transport seam (`askBrain`) is injected by the caller.
 *
 * Reference: `porting/01-orchestration/README.md`,
 * `re/full-reverse/01-generator-loop/REPORT.md` §2, §4.
 */
export * from './budget'
export { extractSpec } from './extract'
export { designLoop, droppedConnection, isDone } from './loop'
export type * from './types'
