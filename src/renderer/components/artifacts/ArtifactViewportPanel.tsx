/**
 * The artifact viewport, shown as a tab beside the chat that produced it.
 *
 * The canvas solves the same problem the same way (AD-19): the GPU surface lives
 * in a layer outside the tab tree, and a panel only claims a slot it is laid
 * over while visible. A WebGL context per chat message is not an option — the
 * transcript is virtualized, so rows mount and unmount as the user scrolls, and
 * every unmount would destroy a context.
 *
 * The tab only exists once something has been generated, so a chat that never
 * asked for an artifact never shows an empty 3D view.
 */

import { useEffect, useRef } from 'react'
import { Layers } from '@/components/icons'
import { useArtifactStore } from '@/stores/artifact-store'
import { useArtifactSlots } from './artifact-slots'

export function ArtifactViewportPanel(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const claimSlot = useArtifactSlots((state) => state.claimSlot)
  const releaseSlot = useArtifactSlots((state) => state.releaseSlot)

  useEffect(() => {
    const element = hostRef.current
    if (!element) return
    claimSlot(element)
    return () => releaseSlot(element)
  }, [claimSlot, releaseSlot])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Artifact</span>
        <span className="text-[11px] text-muted-foreground">live 3D preview</span>
      </div>
      <div ref={hostRef} className="relative min-h-0 flex-1" />
    </div>
  )
}

/** Whether the viewport tab should exist at all. */
export function useHasArtifact(): boolean {
  return useArtifactStore((state) => state.current !== null)
}
