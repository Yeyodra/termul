/**
 * The artifact tab: one artifact, full size.
 *
 * A plain panel rather than an overlay. The chat cards each own their canvas, so
 * this tab does not have to host a shared surface and closing it cannot take the
 * in-chat viewports with it.
 */

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

export function ArtifactViewportPanel(): React.JSX.Element {
  const entries = useArtifactStore((state) => state.entries)
  const newest = entries[entries.length - 1]

  return (
    <div className="flex h-full w-full flex-col overflow-auto p-3">
      {newest ? (
        <ArtifactCard
          key={newest.id}
          artifact={newest.artifact}
          title={titleOf(newest.artifact)}
          still={newest.still}
          defaultOpen
        />
      ) : (
        <p className="m-auto text-xs text-muted-foreground">
          Generate something and it will appear here.
        </p>
      )}
    </div>
  )
}
