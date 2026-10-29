/**
 * Which garment the Roblox surface has open.
 *
 * The collection lives in the Side panel (D2) and the viewport lives in the page
 * (D6), so the picked record has to be shared between two components that no
 * longer share a parent. A store is the seam: the list writes, the page reads.
 *
 * The key is the project path, so switching projects does not carry a pick
 * across. Nothing here is persisted: after a relaunch the newest record is the
 * one a page shows, which is what the collection already defaults to.
 *
 * `draft` is the third state, and it is not "no pick yet": it means the user asked
 * for a blank garment. Without it, "New" could only ever mean "show the newest
 * record", so pressing it would look like it did nothing.
 */

import { create } from 'zustand'

interface RobloxSelectionState {
  /** Project path -> slug of the record the page should show. */
  pickedByProject: Record<string, string>
  /** Project paths where the page shows a blank garment instead of a record. */
  draftByProject: Record<string, boolean>
  pick: (projectPath: string, slug: string) => void
  startDraft: (projectPath: string) => void
}

export const useRobloxSelectionStore = create<RobloxSelectionState>((set) => ({
  pickedByProject: {},
  draftByProject: {},
  pick: (projectPath, slug) => {
    set((state) => {
      if (!projectPath) return {}
      const samePick = state.pickedByProject[projectPath] === slug
      const wasDraft = state.draftByProject[projectPath] === true
      if (samePick && !wasDraft) return {}
      const draftByProject = { ...state.draftByProject }
      delete draftByProject[projectPath]
      return {
        pickedByProject: { ...state.pickedByProject, [projectPath]: slug },
        draftByProject
      }
    })
  },
  startDraft: (projectPath) => {
    if (!projectPath) return
    set((state) => {
      const alreadyDraft = state.draftByProject[projectPath] === true
      const hadPick = projectPath in state.pickedByProject
      if (alreadyDraft && !hadPick) return {}
      // The pick has to go, not just be overridden: leaving it behind meant that
      // pressing New while a garment was open left the page showing that garment,
      // because the pick was still there to fall back to.
      const pickedByProject = { ...state.pickedByProject }
      delete pickedByProject[projectPath]
      return {
        pickedByProject,
        draftByProject: { ...state.draftByProject, [projectPath]: true }
      }
    })
  }
}))

/** The picked slug for a project, or `undefined` while nothing was picked. */
export function usePickedSlug(projectPath: string | undefined): string | undefined {
  return useRobloxSelectionStore((state) =>
    projectPath ? state.pickedByProject[projectPath] : undefined
  )
}

/** Whether the page should show a blank garment. */
export function useIsDraft(projectPath: string | undefined): boolean {
  return useRobloxSelectionStore((state) =>
    projectPath ? state.draftByProject[projectPath] === true : false
  )
}

export function pickSlug(projectPath: string, slug: string): void {
  useRobloxSelectionStore.getState().pick(projectPath, slug)
}

export function startDraft(projectPath: string): void {
  useRobloxSelectionStore.getState().startDraft(projectPath)
}
