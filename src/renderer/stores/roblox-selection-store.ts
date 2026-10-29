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
 */

import { create } from 'zustand'

interface RobloxSelectionState {
  /** Project path -> slug of the record the page should show. */
  pickedByProject: Record<string, string>
  pick: (projectPath: string, slug: string) => void
}

export const useRobloxSelectionStore = create<RobloxSelectionState>((set) => ({
  pickedByProject: {},
  pick: (projectPath, slug) => {
    set((state) => {
      if (!projectPath || state.pickedByProject[projectPath] === slug) return {}
      return { pickedByProject: { ...state.pickedByProject, [projectPath]: slug } }
    })
  }
}))

/** The picked slug for a project, or `undefined` while nothing was picked. */
export function usePickedSlug(projectPath: string | undefined): string | undefined {
  return useRobloxSelectionStore((state) =>
    projectPath ? state.pickedByProject[projectPath] : undefined
  )
}

export function pickSlug(projectPath: string, slug: string): void {
  useRobloxSelectionStore.getState().pick(projectPath, slug)
}
