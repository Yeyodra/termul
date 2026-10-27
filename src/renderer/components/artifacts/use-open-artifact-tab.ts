/**
 * Opens the artifact tab the first time something is generated.
 *
 * Kept as a hook rather than done inside the publish call, because the store
 * that knows about artifacts must not know about panes: publishing is a data
 * concern, opening a tab is a workspace one.
 *
 * It only acts on the first artifact. A second generation replaces what the
 * viewport shows without stealing focus, because the user is probably still
 * reading the chat that asked for it.
 */

import { useEffect, useRef } from 'react'
import { useArtifactStore } from '@/stores/artifact-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** The id every artifact tab uses: one viewport, one tab. */
export const ARTIFACT_TAB_ID = 'artifact-viewport'

export function useOpenArtifactTab(): void {
  const current = useArtifactStore((state) => state.current)
  const opened = useRef(false)

  useEffect(() => {
    if (!current || opened.current) return
    opened.current = true
    const { activePaneId, addTabToPane } = useWorkspaceStore.getState()
    addTabToPane(activePaneId, { type: 'artifact', id: ARTIFACT_TAB_ID }, { focus: false })
  }, [current])
}
