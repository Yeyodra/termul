/**
 * The artifacts this session has generated, newest first.
 *
 * Kept as a list rather than a single value so an earlier garment stays
 * reachable after the next generation replaces it. Only one entry is *live* —
 * there is one WebGL surface — and the rest show the still image the engine
 * already produced, which is enough to recognise and reopen them.
 *
 * The artifact never travels through a message: `acp-store` discards any
 * tool-result field over 128 KiB (`transcript.ts:433`) and an atlas is far
 * larger, so publishing it there would arrive empty.
 */

import { create } from 'zustand'
import type { Artifact } from '@/lib/generator/viewport/artifact'

export interface ArtifactEntry {
  /** Stable id for React keys and for choosing which entry is live. */
  id: string
  artifact: Artifact
  /** A still picture of the artifact, for the cards that are not live. */
  still?: string
  at: number
}

interface ArtifactState {
  entries: ArtifactEntry[]
  /** Which entry the live surface is showing. */
  liveId: string | null
  publish: (artifact: Artifact, still?: string) => void
  /** Make an earlier entry live again. */
  focus: (id: string) => void
  clear: () => void
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  entries: [],
  liveId: null,
  publish: (artifact, still) => {
    const id = `artifact-${get().entries.length + 1}-${artifact.kind}`
    set((state) => ({
      entries: [{ id, artifact, still, at: Date.now() }, ...state.entries],
      liveId: id
    }))
  },
  focus: (id) => {
    if (get().entries.some((entry) => entry.id === id)) set({ liveId: id })
  },
  clear: () => set({ entries: [], liveId: null })
}))

/** The entry the live surface is showing, falling back to the newest. */
export function useLiveArtifact(): ArtifactEntry | null {
  return useArtifactStore(
    (state) => state.entries.find((entry) => entry.id === state.liveId) ?? state.entries[0] ?? null
  )
}
