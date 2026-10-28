/**
 * One generated artifact, with its own 3D canvas.
 *
 * Each card owns a viewport, so a session can show every garment it generated at
 * the same time. The scene is built once on mount and kept until the card
 * unmounts, which means scrolling back to an earlier card re-frames it rather
 * than rebuilding it.
 *
 * The card collapses to a still by default: a transcript full of live WebGL
 * surfaces is expensive to paint, and most of the time the reader only wants to
 * recognise which garment it was. Opening it starts the scene.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Maximize2 } from '@/components/icons'
import type { Rig } from '@/lib/generator/engines/clothing/avatar/rig'
import { type Artifact, buildArtifactScene } from '@/lib/generator/viewport/artifact'
import { ArtifactViewport, type ViewDirection } from '@/lib/generator/viewport/core'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ARTIFACT_TAB_ID } from './artifact-tab-id'

const FACING: Array<{ id: ViewDirection; label: string }> = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: '3/4', label: '3/4' }
]

const RIGS: Rig[] = ['R15', 'R6']

const OPTION =
  'rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground'
const OPTION_ON = 'bg-foreground/10 text-foreground'

export interface ArtifactCardProps {
  artifact: Artifact
  title: string
  still?: string
  /** Open on mount, for the newest artifact. */
  defaultOpen?: boolean
}

export function ArtifactCard({
  artifact,
  title,
  still,
  defaultOpen = false
}: ArtifactCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<ArtifactViewport | null>(null)
  const disposeSceneRef = useRef<(() => void) | null>(null)
  const [facing, setFacing] = useState<ViewDirection>('3/4')
  const [rig, setRig] = useState<Rig>('R15')
  const [spin, setSpin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const stageRef = useCallback((element: HTMLDivElement | null) => {
    hostRef.current = element
  }, [])

  useEffect(() => {
    if (!open) return
    const host = hostRef.current
    if (!host) return
    const viewport = new ArtifactViewport(host)
    viewportRef.current = viewport
    return () => {
      disposeSceneRef.current?.()
      disposeSceneRef.current = null
      viewport.dispose()
      viewportRef.current = null
    }
  }, [open])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!open || !viewport) return
    let cancelled = false
    const rebuilt: Artifact = artifact.kind === 'clothing' ? { ...artifact, rig } : artifact

    buildArtifactScene(rebuilt)
      .then((scene) => {
        if (cancelled) {
          scene.dispose()
          return
        }
        disposeSceneRef.current?.()
        disposeSceneRef.current = scene.dispose
        setLabel(scene.label)
        setError(null)
        viewport.show(scene.objects, facing)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [open, artifact, rig, facing])

  useEffect(() => {
    viewportRef.current?.setSpin(spin)
  }, [spin])

  const garment = artifact.kind === 'clothing'

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-[#0e0f13]">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{title}</span>
        </button>
        <span className="flex-1" />
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

      {open ? (
        <>
          <div ref={stageRef} className="h-[300px] w-full" />
          {error && (
            <p className="mx-3 mb-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-1 border-t border-border/60 px-2 py-1">
            <span className="truncate text-[11px] text-muted-foreground">{label}</span>
            <span className="flex-1" />
            {garment && (
              <>
                <fieldset className="flex items-center gap-0.5 border-0 p-0">
                  {RIGS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={rig === option}
                      className={cn(OPTION, rig === option && OPTION_ON)}
                      onClick={() => setRig(option)}
                    >
                      {option}
                    </button>
                  ))}
                </fieldset>
                <fieldset className="flex items-center gap-0.5 border-0 p-0">
                  {FACING.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={facing === option.id}
                      className={cn(OPTION, facing === option.id && OPTION_ON)}
                      onClick={() => setFacing(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </fieldset>
                <button
                  type="button"
                  aria-pressed={spin}
                  className={cn(OPTION, spin && OPTION_ON)}
                  onClick={() => setSpin((on) => !on)}
                >
                  Spin
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        still && (
          <button type="button" className="block w-full" onClick={() => setOpen(true)}>
            <img src={still} alt={title} className="max-h-[220px] w-full object-contain" />
          </button>
        )
      )}
    </div>
  )
}
