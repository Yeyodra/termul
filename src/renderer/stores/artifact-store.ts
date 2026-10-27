/**
 * The artifact the viewport is showing, kept outside the chat transcript.
 *
 * A generated garment is megabytes of atlas; `acp-store` discards any tool
 * result field over 128 KiB (`transcript.ts:433`), so an artifact that travelled
 * through a message would arrive empty. It is published here instead, and the
 * message that announced it only carries a reference.
 *
 * One artifact is current at a time, because there is one viewport: a second
 * generation replaces the first, which matches what the user sees.
 */

import { create } from 'zustand'
import type { Artifact } from '@/lib/generator/viewport/artifact'

interface ArtifactState {
  /** What the viewport is showing, or null before the first generation. */
  current: Artifact | null
  /** Which project produced it, so a project switch can clear it. */
  projectId: string | null
  /** True while the viewport panel is on screen. */
  open: boolean
  publish: (artifact: Artifact, projectId: string | null) => void
  setOpen: (open: boolean) => void
  clear: () => void
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  current: null,
  projectId: null,
  open: false,
  publish: (artifact, projectId) => set({ current: artifact, projectId, open: true }),
  setOpen: (open) => set({ open }),
  clear: () => set({ current: null, projectId: null, open: false })
}))
