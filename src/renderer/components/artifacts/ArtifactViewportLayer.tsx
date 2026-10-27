/**
 * The one WebGL surface every generated artifact is shown on.
 *
 * Kept outside the tab tree, beside `CanvasMountLayer`, for the same reasons the
 * canvas is (AD-19): a chat tab that is not the active one stays mounted but
 * invisible (`PaneContent.INACTIVE_TAB_PANE_CLASS`), so a viewport inside a tab
 * would exist once per open chat, all of them invisible, each holding a GPU
 * context. Here there is exactly one, and a visible `ArtifactViewportPanel`
 * only tells it where to draw by claiming a slot.
 *
 * It also survives a shell breakpoint flip and a project switch, which is what
 * lets a generation finish while the user is looking at another tab.
 */

import { useEffect, useRef, useState } from 'react'
import { useArtifactSlots } from '@/components/artifacts/artifact-slots'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import { useLiveArtifact } from '@/stores/artifact-store'

export function ArtifactViewportLayer(): React.JSX.Element | null {
  const entry = useLiveArtifact()
  const artifact = entry?.artifact ?? null
  const slot = useArtifactSlots((state) => state.slot)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!slot) {
      setRect(null)
      return
    }
    const measure = (): void => setRect(slot.getBoundingClientRect())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [slot])

  if (!artifact) return null

  const placed = slot && rect && rect.width > 0 && rect.height > 0

  return (
    <div
      ref={frameRef}
      className="pointer-events-auto fixed z-20"
      style={
        placed
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : { left: -10000, top: 0, width: 1, height: 1 }
      }
      aria-hidden={placed ? undefined : true}
    >
      <ArtifactViewportPanel artifact={artifact} />
    </div>
  )
}
