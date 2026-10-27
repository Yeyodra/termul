/**
 * Where the live artifact surface is drawn.
 *
 * A card registers its stage element here; the single global surface is laid
 * over whichever one is registered. Registration is a callback ref, not an
 * effect, because the element only exists once there is an artifact to show.
 */

import { create } from 'zustand'

interface ArtifactSlotState {
  slot: HTMLElement | null
  claimSlot: (element: HTMLElement) => void
  releaseSlot: (element: HTMLElement | null) => void
}

export const useArtifactSlots = create<ArtifactSlotState>((set) => ({
  slot: null,
  claimSlot: (element) => set((state) => (state.slot === element ? {} : { slot: element })),
  releaseSlot: (element) =>
    set((state) => (element === null || state.slot === element ? { slot: null } : {}))
}))
