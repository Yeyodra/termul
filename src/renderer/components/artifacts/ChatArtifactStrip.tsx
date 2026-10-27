/**
 * The artifact cards for this chat, newest last.
 *
 * Placed at the end of the conversation rather than pinned above the composer,
 * so each generation sits with the turn that produced it and the reader can
 * scroll back to an earlier garment without it being replaced.
 *
 * Exactly one card is live: the store's `liveId`. The others show the still the
 * engine already rendered, so there is never a second WebGL context.
 */

import { useArtifactStore } from '@/stores/artifact-store'
import { ChatArtifactCard } from './ChatArtifactCard'

export function ChatArtifactStrip(): React.JSX.Element | null {
  const entries = useArtifactStore((state) => state.entries)
  const liveId = useArtifactStore((state) => state.liveId)

  if (entries.length === 0) return null

  // Oldest first, so the newest generation is nearest the composer and the
  // transcript reads in the order the work happened.
  const ordered = [...entries].reverse()
  const live = liveId ?? entries[0]?.id ?? null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-2">
      {ordered.map((entry) => (
        <ChatArtifactCard
          key={entry.id}
          entryId={entry.id}
          live={entry.id === live}
          title={titleOf(entry.artifact)}
          still={entry.still}
        />
      ))}
    </div>
  )
}

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
