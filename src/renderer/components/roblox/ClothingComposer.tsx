/**
 * The page composer: describe a garment without leaving the Roblox surface.
 *
 * It does not generate anything itself. A record is written by the host, and the
 * host only writes one when an agent's tool call finishes, so the composer hands
 * the prompt to the agent launcher and lets the normal path run. That is also
 * what keeps this honest: the collection cannot contain a record no agent made.
 *
 * The handoff is `PersistenceKeys.lastLaunchDraft`, which `AgentLauncher`
 * already hydrates from on mount. Writing it before opening the launcher means
 * the user finds their text in the composer instead of an empty box, with no new
 * store and no new IPC.
 */

import { PersistenceKeys } from '@shared/types/persistence.types'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles } from '@/components/icons'
import { persistenceApi } from '@/lib/api'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import { useActiveProject } from '@/stores/project-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** Write the draft, then open the launcher on the workspace route. */
async function handOff(
  projectId: string,
  text: string,
  pathname: string,
  go: (path: string) => void
): Promise<void> {
  await persistenceApi.write(PersistenceKeys.lastLaunchDraft(projectId), text).catch(() => {})
  const open = (): void => {
    const paneId = useWorkspaceStore.getState().activePaneId
    if (paneId) useWorkspaceStore.getState().showAgentLauncher(paneId)
  }
  // The launcher overlay only renders on the workspace route, so leave the
  // Roblox page first when the composer was used from there.
  if (pathname !== '/') {
    go('/')
    requestAnimationFrame(open)
  } else {
    open()
  }
}

/**
 * What `Apply` asks for: a revision of the garment on screen.
 *
 * The name is named on purpose. The host files a record by the name the model
 * returns, so asking for the same name is what makes this land as a new version
 * of the same item rather than a second item beside it. `O3` (`item_id`) would
 * make that exact instead of requested.
 */
export function revisionPrompt(record: ArtifactRecord, change: string): string {
  const version = currentVersion(record)
  const label = version.prompt?.trim() || record.slug
  return `Revise the existing garment "${label}" (v${version.n}). Change: ${change.trim()}. Keep everything else the same and keep the same name, so this lands as a new version of the same item.`
}

interface ClothingComposerProps {
  record: ArtifactRecord | null
}

export function ClothingComposer({ record }: ClothingComposerProps): React.JSX.Element {
  const project = useActiveProject()
  const navigate = useNavigate()
  const pathname = useLocation().pathname
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const canSend = Boolean(project?.id) && text.trim().length > 0 && !busy

  const send = async (prompt: string): Promise<void> => {
    if (!project?.id || !prompt.trim() || busy) return
    setBusy(true)
    try {
      await handOff(project.id, prompt.trim(), pathname, navigate)
      if (mounted.current) setText('')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            if (canSend) void send(text)
          }}
          placeholder={record ? 'Describe a change to this garment…' : 'Describe a garment…'}
          aria-label="Describe a garment"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-card px-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-hidden"
        />
        <button
          type="button"
          disabled={!canSend || !record}
          onClick={() => {
            if (record) void send(revisionPrompt(record, text))
          }}
          title={record ? 'Revise the garment on screen' : 'Pick a garment first'}
          className="h-8 shrink-0 rounded-md border border-border px-2 text-xs text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          Apply
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void send(text)}
          title="Start a new garment from this prompt"
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={12} aria-hidden="true" />
          New
        </button>
      </div>
      <p className="pt-1 text-3xs leading-relaxed text-muted-foreground">
        The prompt opens in the agent launcher: a garment is written by the host when the agent
        finishes, so nothing is generated until you send it there.
      </p>
    </div>
  )
}
