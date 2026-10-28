/**
 * The artifacts a session generated, in the order they were made.
 *
 * Every entry keeps its own scene and its own canvas, so any number of cards can
 * be live at once. That is a deliberate reversal of the first attempt, which
 * shared one WebGL surface: sharing meant only one card could ever be live, and
 * closing the tab that owned the surface lost the viewport entirely.
 *
 * One context per card is affordable because the count is bounded by how many
 * artifacts a session generated, not by how many messages it holds.
 */

import { create } from 'zustand'
import type { Artifact } from '@/lib/generator/viewport/artifact'

export interface ArtifactEntry {
  id: string
  artifact: Artifact
  /** The still the engine rendered, so a card shows something before its scene builds. */
  still?: string
  at: number
}

interface ArtifactState {
  entries: ArtifactEntry[]
  publish: (artifact: Artifact, still?: string) => void
  clear: () => void
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  entries: [],
  publish: (artifact, still) => {
    const id = `artifact-${get().entries.length + 1}`
    set((state) => ({ entries: [...state.entries, { id, artifact, still, at: Date.now() }] }))
  },
  clear: () => set({ entries: [] })
}))
