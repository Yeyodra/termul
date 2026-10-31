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
  /**
   * Project path -> the records the outfit preview wears.
   *
   * A pair of garments is not recorded on disk: `item.json` holds a slug, a kind
   * and its versions, and nothing says "this pair of trousers belongs with that
   * shirt". So the pairing cannot be inferred - the newest of each kind is a
   * guess, and it put a fresh garment in an old outfit. The user marks the pieces
   * instead, and this is where that mark lives.
   *
   * Keyed by `kind:slug`, because a slug alone is ambiguous: the same one really
   * does exist under two kinds.
   */
  wornByProject: Record<string, string[]>
  pick: (projectPath: string, slug: string) => void
  startDraft: (projectPath: string) => void
  /** Wear or take off one record in the outfit preview. */
  toggleWorn: (projectPath: string, record: { kind: string; slug: string }) => void
}

export const useRobloxSelectionStore = create<RobloxSelectionState>((set) => ({
  pickedByProject: {},
  draftByProject: {},
  wornByProject: {},
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
  },
  toggleWorn: (projectPath, record) => {
    if (!projectPath) return
    const key = `${record.kind}:${record.slug}`
    set((state) => {
      const current = state.wornByProject[projectPath] ?? []
      const next = current.includes(key) ? current.filter((one) => one !== key) : [...current, key]
      return { wornByProject: { ...state.wornByProject, [projectPath]: next } }
    })
  }
}))

/**
 * The picked record's key for a project, or `undefined` while nothing was picked.
 *
 * The key is `kind:slug`, not the slug alone. A slug is only unique within a
 * kind: generating a character from a building named the record the same way, so
 * two records really did exist as `building/brick-cottage` and
 * `character/brick-cottage`. Keyed by slug, picking either one selected both, and
 * the page then showed whichever it found first - so the older record could not
 * be opened at all.
 */
export function usePickedSlug(projectPath: string | undefined): string | undefined {
  return useRobloxSelectionStore((state) =>
    projectPath ? state.pickedByProject[projectPath] : undefined
  )
}

/** Whether a record is the picked one. */
export function isPicked(
  picked: string | undefined,
  record: { kind: string; slug: string }
): boolean {
  return picked === `${record.kind}:${record.slug}`
}

/** Whether the page should show a blank garment. */
export function useIsDraft(projectPath: string | undefined): boolean {
  return useRobloxSelectionStore((state) =>
    projectPath ? state.draftByProject[projectPath] === true : false
  )
}

/**
 * Pick a record, by its kind and slug.
 *
 * `kind` is required because a slug alone is ambiguous: the same one can exist
 * under two kinds, and a pick that cannot tell them apart selects both.
 */
export function pickSlug(projectPath: string, slug: string, kind?: string): void {
  useRobloxSelectionStore.getState().pick(projectPath, kind ? `${kind}:${slug}` : slug)
}

export function startDraft(projectPath: string): void {
  useRobloxSelectionStore.getState().startDraft(projectPath)
}

/** A shared empty list, so a project with nothing worn returns a stable value. */
const NONE: string[] = []

/**
 * The `kind:slug` keys the outfit preview wears in this project.
 *
 * The fallback is a module constant, not `[]`: a fresh array on every call is a
 * new reference each render, which made the store notify forever and took the
 * whole page down with "Maximum update depth exceeded".
 */
export function useWornKeys(projectPath: string | undefined): string[] {
  return useRobloxSelectionStore((state) =>
    projectPath ? (state.wornByProject[projectPath] ?? NONE) : NONE
  )
}

export function toggleWorn(projectPath: string, record: { kind: string; slug: string }): void {
  useRobloxSelectionStore.getState().toggleWorn(projectPath, record)
}
