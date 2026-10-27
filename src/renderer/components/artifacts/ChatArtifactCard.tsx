/**
 * The generated artifact as a card inside the chat session.
 *
 * The slot is claimed through a callback ref rather than an effect: the element
 * only exists once there is an artifact to show, so an effect keyed on mount
 * would run while the ref was still null and never claim anything — which is
 * exactly why the card used to render empty.
 *
 * The card that owns the live surface draws the real 3D scene. Older cards show
 * the still the engine already rendered, so scrolling back through a session
 * keeps every earlier garment visible without a second WebGL context.
 */

import { useCallback } from 'react'
import { Layers, Maximize2 } from '@/components/icons'
import { useArtifactStore } from '@/stores/artifact-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useArtifactSlots } from './artifact-slots'
import { ARTIFACT_TAB_ID } from './artifact-tab-id'

export interface ChatArtifactCardProps {
  entryId: string
  /** True for the one card whose stage the live surface is drawn over. */
  live: boolean
  title: string
  still?: string
}

export function ChatArtifactCard({
  entryId,
  live,
  title,
  still
}: ChatArtifactCardProps): React.JSX.Element {
  const claimSlot = useArtifactSlots((state) => state.claimSlot)
  const releaseSlot = useArtifactSlots((state) => state.releaseSlot)
  const focus = useArtifactStore((state) => state.focus)

  const slotRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) claimSlot(element)
      else releaseSlot(element as unknown as HTMLDivElement)
    },
    [claimSlot, releaseSlot]
  )

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-[#0e0f13]">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {live ? 'live 3D' : '3D'}
        </span>
        <span className="flex-1" />
        {!live && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => focus(entryId)}
          >
            Show live
          </button>
        )}
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            const { activePaneId, addTabToPane } = useWorkspaceStore.getState()
            addTabToPane(activePaneId, { type: 'artifact', id: ARTIFACT_TAB_ID })
          }}
        >
          <Maximize2 className="h-3 w-3" />
          Expand
        </button>
      </div>
      {live ? (
        <div ref={slotRef} className="h-[320px] w-full" />
      ) : (
        <div className="flex h-[320px] w-full items-center justify-center bg-[#0e0f13]">
          {still ? (
            <img src={still} alt={title} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[11px] text-muted-foreground">No preview kept</span>
          )}
        </div>
      )}
    </div>
  )
}
