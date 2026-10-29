/**
 * The page composer: describe a garment and get it, without leaving the page.
 *
 * This is the 1:1 of RobloxKit's composer, which calls its own engine and writes
 * the item itself. Termul runs the same engine here and asks the host to write
 * the record, because the host owns the project folder and the only checked
 * binary-write path. The user experience is the same: type, press Make, watch the
 * viewport fill in, and the garment lands in the collection on this page.
 *
 * Two buttons, mirroring the panel this ports: `Make it` starts from the prompt
 * alone, and `Apply` revises the garment on screen, which needs a record to exist.
 */

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Zap } from '@/components/icons'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import { runPageGeneration } from '@/lib/roblox-generate'
import { cn } from '@/lib/utils'
import { useStageStore } from '@/stores/roblox-stage-store'

const TYPES: Array<{ id: DesignType; label: string }> = [
  { id: 'shirt', label: 'Shirt' },
  { id: 'pants', label: 'Pants' },
  { id: 'tshirt', label: 'T-shirt' }
]

/**
 * What `Apply` asks for: a revision of the garment on screen.
 *
 * The name is named on purpose. The host files a record by the name the model
 * returns, so asking for the same name is what makes this land as a new version
 * of the same item instead of a second item beside it.
 */
export function revisionPrompt(record: ArtifactRecord, change: string): string {
  const version = currentVersion(record)
  const label = version.prompt?.trim() || record.slug
  return `Revise the existing garment "${label}" (v${version.n}). Change: ${change.trim()}. Keep everything else the same and keep the same name, so this lands as a new version of the same item.`
}

interface ClothingComposerProps {
  projectPath: string
  record: ArtifactRecord | null
  /** The garment kind to start with, so the node pipeline and the engine agree. */
  type?: DesignType
  onStage?: (stage: string) => void
  onSettled?: () => void
}

export function ClothingComposer({
  projectPath,
  record,
  type = 'shirt',
  onStage,
  onSettled
}: ClothingComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<DesignType>(type)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const canSend = text.trim().length > 0 && !busy

  const run = async (prompt: string): Promise<void> => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    useStageStore
      .getState()
      .set(projectPath, { state: 'running', stage: 'Design', layer: 0, total: 0, error: null })
    onStage?.('running')
    try {
      const outcome = await runPageGeneration({
        projectPath,
        prompt: prompt.trim(),
        type: kind,
        onStage: (stage) => {
          if (mounted.current) {
            useStageStore.getState().set(projectPath, { stage })
            onStage?.(stage)
          }
        },
        onLayer: (drawn, total) => {
          if (mounted.current) {
            useStageStore.getState().set(projectPath, { layer: drawn, total })
          }
        }
      })
      if (!mounted.current) return
      if (outcome.status === 'done') {
        setText('')
        useStageStore.getState().set(projectPath, { state: 'done', stage: 'Ready' })
        onSettled?.()
      } else if (outcome.status === 'failed') {
        setError(outcome.error)
        useStageStore.getState().set(projectPath, { state: 'error', error: outcome.error })
      } else {
        useStageStore.getState().set(projectPath, { state: 'idle', layer: 0, total: 0 })
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
        onStage?.('idle')
      }
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
            if (canSend) void run(record ? revisionPrompt(record, text) : text)
          }}
          placeholder={
            record
              ? `Change ${currentVersion(record).prompt?.trim() || record.slug} (e.g. "thinner stripes")…`
              : 'Describe a shirt, pants or t-shirt…'
          }
          aria-label="Describe a garment"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-card px-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-hidden"
        />
        <fieldset className="flex shrink-0 items-center gap-0.5 border-0 p-0">
          {TYPES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={kind === option.id}
              disabled={busy}
              onClick={() => setKind(option.id)}
              className={cn(
                'h-8 rounded px-1.5 text-2xs transition-colors disabled:opacity-40',
                kind === option.id
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          disabled={!canSend || !record}
          onClick={() => {
            if (record) void run(revisionPrompt(record, text))
          }}
          title={record ? 'Revise the garment on screen' : 'Pick a garment first'}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <Sparkles size={12} aria-hidden="true" />
          Apply
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void run(text)}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Zap size={12} aria-hidden="true" />
          {busy ? 'Drawing…' : 'Make it'}
        </button>
      </div>
      {error && <p className="pt-1 text-3xs leading-relaxed text-destructive">{error}</p>}
    </div>
  )
}
