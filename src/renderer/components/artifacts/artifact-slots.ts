/**
 * Where the artifact viewport shows.
 *
 * A visible `ArtifactViewportPanel` registers its element here, and the global
 * layer lays the single WebGL surface over it — or parks it offscreen when no
 * tab is showing one. The surface itself never moves in the DOM, so switching
 * tabs does not rebuild the scene.
 */

import { create } from 'zustand'

interface ArtifactSlotState {
  slot: HTMLElement | null
  claimSlot: (element: HTMLElement) => void
  /** Releases the slot only while `element` still holds it. */
  releaseSlot: (element: HTMLElement) => void
}

export const useArtifactSlots = create<ArtifactSlotState>((set) => ({
  slot: null,
  claimSlot: (element) => set((state) => (state.slot === element ? {} : { slot: element })),
  releaseSlot: (element) => set((state) => (state.slot === element ? { slot: null } : {}))
}))
