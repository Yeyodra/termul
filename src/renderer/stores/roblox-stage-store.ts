/**
 * The stage the page is in, and the line the viewport shows while it draws.
 *
 * RobloxKit has a 4-state machine (`stageStatus-DQVaoIXS.js`) driving ten panels,
 * and it can do that because its task queue lives in the renderer and knows which
 * item a job is editing. Termul cannot: the host owns the record write, and a
 * tool call's title does not survive a restore. So this reports the three states
 * it can actually prove - `idle`, `running`, `done`/`error` - rather than four
 * with one that lies.
 *
 * The layer counter is real: it comes from `onLayer` in the render, not from a
 * timer, so "Drawing layer 5 of 7" is where the sheet actually is.
 */

import { create } from 'zustand'

export type StageState = 'idle' | 'running' | 'done' | 'error'

export interface StageSnapshot {
  state: StageState
  /** 1-based layer being drawn, or 0 before the first one. */
  layer: number
  total: number
  /** What the engine last reported, e.g. Design, Render, Checks. */
  stage: string
  /** The sheet as it is being drawn, so the page can show it growing. */
  sheet: string | null
  error: string | null
}

const IDLE: StageSnapshot = {
  state: 'idle',
  layer: 0,
  total: 0,
  stage: '',
  sheet: null,
  error: null
}

interface StageStore {
  byProject: Record<string, StageSnapshot>
  set: (projectPath: string, next: Partial<StageSnapshot>) => void
  reset: (projectPath: string) => void
}

export const useStageStore = create<StageStore>((set) => ({
  byProject: {},
  set: (projectPath, next) => {
    set((state) => {
      const current = state.byProject[projectPath] ?? IDLE
      return { byProject: { ...state.byProject, [projectPath]: { ...current, ...next } } }
    })
  },
  reset: (projectPath) => {
    set((state) => ({ byProject: { ...state.byProject, [projectPath]: IDLE } }))
  }
}))

export function useStage(projectPath: string | undefined): StageSnapshot {
  return useStageStore((state) => (projectPath ? (state.byProject[projectPath] ?? IDLE) : IDLE))
}

/** The line under the viewport while a generation runs. */
export function progressLine(snapshot: StageSnapshot): string | null {
  if (snapshot.state !== 'running') return null
  if (snapshot.total > 0) return `Drawing layer ${snapshot.layer} of ${snapshot.total}`
  return snapshot.stage ? `${snapshot.stage}…` : 'Starting…'
}
