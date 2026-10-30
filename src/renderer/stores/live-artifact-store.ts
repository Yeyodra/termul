/**
 * The pictures a generation produced, kept in renderer memory.
 *
 * The host owns the durable transcript, so the renderer cannot insert a message:
 * a picture written into the transcript is only durable once the host records it,
 * and the chunk the host emits for it is lossy - it never opens a bubble live.
 *
 * RobloxKit solves the same problem by keeping chat items in a Map and persisting
 * afterwards; this is the same split. Live pictures come from here, and after a
 * relaunch the transcript carries the host's durable copy instead.
 */

import { create } from 'zustand'

interface LiveArtifactState {
  /** Session id → the picture each finished task produced. */
  pictures: Record<string, Record<string, string>>
  show: (sessionId: string, taskId: string, picture: string) => void
  clear: () => void
}

export const useLiveArtifactStore = create<LiveArtifactState>((set) => ({
  pictures: {},
  show: (sessionId, taskId, picture) => {
    set((state) => {
      const forSession = state.pictures[sessionId] ?? {}
      if (forSession[taskId] === picture) return {}
      return { pictures: { ...state.pictures, [sessionId]: { ...forSession, [taskId]: picture } } }
    })
  },
  clear: () => set({ pictures: {} })
}))

/** The newest live picture of a session, or `null` when none arrived. */
export function useLatestLivePicture(sessionId: string | undefined): string | null {
  return useLiveArtifactStore((state) => {
    if (!sessionId) return null
    const forSession = state.pictures[sessionId]
    if (!forSession) return null
    const values = Object.values(forSession)
    return values.length > 0 ? (values[values.length - 1] ?? null) : null
  })
}
