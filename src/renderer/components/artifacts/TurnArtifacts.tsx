/**
 * The artifact cards belonging to one turn.
 *
 * Rendered inside the turn's own content rather than pinned under the
 * transcript, so scrolling past the reply also scrolls past its viewport and the
 * conversation keeps its shape no matter how many garments were generated.
 *
 * Each card owns its canvas, so every one of them can be live at the same time.
 */

import { useMemo } from 'react'
import { useArtifactStore } from '@/stores/artifact-store'
import { ArtifactCard } from './ArtifactCard'

function titleOf(artifact: { kind: string; name?: string }): string {
  const name = artifact.name?.trim()
  if (name) return name
  switch (artifact.kind) {
    case 'clothing':
      return 'Garment'
    case 'mesh':
      return 'Model'
    case 'skybox':
      return 'Skybox'
    case 'texture':
      return 'Texture'
    default:
      return 'Artifact'
  }
}

export function TurnArtifacts({ live }: { live: boolean }): React.JSX.Element | null {
  const entries = useArtifactStore((state) => state.entries)
  const shown = useMemo(() => (live ? entries : entries.slice(-1)), [entries, live])

  if (shown.length === 0) return null

  return (
    <div className="flex flex-col gap-2 pt-2">
      {shown.map((entry, index) => (
        <ArtifactCard
          key={entry.id}
          artifact={entry.artifact}
          title={titleOf(entry.artifact)}
          still={entry.still}
          defaultOpen={index === shown.length - 1}
        />
      ))}
    </div>
  )
}
