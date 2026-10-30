/**
 * The React face of the viewport: one canvas, one artifact, one teardown.
 *
 * Deliberately thin. The class in `core.ts` owns the GPU; this component owns
 * its lifetime, which is the only thing React is good for here. Mounting a new
 * artifact builds a new scene and disposes the old one, because leaving the old
 * group attached would keep its textures alive for as long as the panel is open.
 *
 * The controls are the ones RobloxKit's clothing panel offers (R15/R6, facing,
 * spin). Template is omitted on purpose: the flat atlas is shown by the
 * generation itself, and repeating it here would be a flat image in a 3D frame.
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Rig } from '../engines/clothing/avatar/rig'
import { type Artifact, buildArtifactScene } from './artifact'
import { ArtifactViewport, type ViewDirection } from './core'

export interface ArtifactViewportPanelProps {
  artifact: Artifact | null
  placeholder?: string
  className?: string
}

const FACING: Array<{ id: ViewDirection; label: string }> = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: '3/4', label: '3/4' }
]

const RIGS: Rig[] = ['R15', 'R6']

const OPTION =
  'rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground'
const OPTION_ON = 'bg-foreground/10 text-foreground'

export function ArtifactViewportPanel({
  artifact,
  placeholder = 'Nothing generated yet.',
  className
}: ArtifactViewportPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<ArtifactViewport | null>(null)
  const disposeSceneRef = useRef<(() => void) | null>(null)
  const [facing, setFacing] = useState<ViewDirection>('3/4')
  const [rig, setRig] = useState<Rig>('R15')
  const [spin, setSpin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    // No artifact means "show nothing", not "leave the last one up". Returning
    // early here kept the previous garment's scene attached, so starting a new
    // garment cleared the Inspector and the facts but left the old avatar in the
    // viewport - the page looked half-fresh, which reads as a bug.
    if (!artifact) {
      disposeSceneRef.current?.()
      disposeSceneRef.current = null
      viewport.clear()
      setLabel('')
      setError(null)
      return
    }

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
  }, [artifact, rig, facing])

  useEffect(() => {
    viewportRef.current?.setSpin(spin)
  }, [spin])

  const garment = artifact?.kind === 'clothing'

  return (
    <div
      className={cn('relative flex h-full w-full flex-col overflow-hidden bg-[#0e0f13]', className)}
    >
      <div ref={hostRef} className="min-h-0 flex-1" />
      {!artifact && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {placeholder}
        </p>
      )}
      {error && (
        <p className="absolute inset-x-0 bottom-8 mx-3 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1 border-t border-border/60 bg-muted/30 px-2 py-1">
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
    </div>
  )
}
