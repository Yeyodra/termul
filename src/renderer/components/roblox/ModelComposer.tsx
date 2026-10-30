/**
 * The 3D page's composer: describe a model and get it, without leaving the page.
 *
 * This is the counterpart of `ClothingComposer`, and the reason it exists is that
 * the 3D page had no prompt box at all: a model could only arrive from an agent
 * chat, while a garment could be asked for on its own page. Same input, same
 * Enter-to-send, same one-button rule.
 *
 * The differences are what a model actually has. There is no outfit to match, so
 * no Match button; there is a category instead of a garment type; and a revision
 * applies to the open model rather than to a garment of the picked kind.
 */

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Zap } from '@/components/icons'
import type { ArtifactRecord } from '@/lib/artifact-records'
import { currentVersion } from '@/lib/artifact-records'
import {
  MODEL_CATEGORIES,
  type ModelCategory,
  modelRevisionPrompt,
  runModelGeneration
} from '@/lib/roblox-generate-3d'
import { cn } from '@/lib/utils'
import { useStageStore } from '@/stores/roblox-stage-store'

const CATEGORY_NOUN: Record<ModelCategory, string> = {
  prop: 'prop',
  building: 'building',
  tool: 'tool',
  character: 'character'
}

interface ModelComposerProps {
  projectPath: string
  /** The model on screen, so `Revise` has something to revise. */
  record: ArtifactRecord | null
  /** Called with the slug the host wrote, after the collection is re-read. */
  onSettled?: (slug: string) => void
  onStage?: (stage: string) => void
}

export function ModelComposer({
  projectPath,
  record,
  onSettled,
  onStage
}: ModelComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<ModelCategory>('prop')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A revision applies to the model on screen, which is what the user is looking
  // at. There is no "kind" to reconcile the way a garment has one, so the open
  // record is always the target when there is one.
  const revising = record
  const canSend = text.trim().length > 0 && !busy

  const run = async (prompt: string): Promise<void> => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    useStageStore.getState().set(projectPath, {
      state: 'running',
      phase: 'draw',
      stage: 'Design',
      layer: 0,
      total: 0,
      sheet: null,
      base: null,
      error: null
    })
    onStage?.('running')
    try {
      const outcome = await runModelGeneration({
        projectPath,
        prompt: revising
          ? modelRevisionPrompt(revising.slug, currentVersion(revising).n, prompt)
          : prompt.trim(),
        category,
        recordSlug: revising?.slug,
        base: revising ? currentVersion(revising).design : undefined,
        onStage: (stage) => {
          useStageStore.getState().set(projectPath, { stage })
          if (mounted.current) onStage?.(stage)
        }
      })
      if (outcome.status === 'done') {
        useStageStore.getState().set(projectPath, {
          state: 'done',
          phase: 'idle',
          stage: 'Ready',
          sheet: null,
          base: null
        })
        // Outside the mount guard: the pick belongs to the project, so a model
        // that landed while the page was closed still opens on return.
        onSettled?.(outcome.saved.slug)
        if (mounted.current) setText('')
      } else if (outcome.status === 'failed') {
        useStageStore.getState().set(projectPath, {
          state: 'error',
          phase: 'idle',
          error: outcome.error
        })
        if (mounted.current) setError(outcome.error)
      } else {
        useStageStore.getState().set(projectPath, { state: 'idle', phase: 'idle' })
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
            if (canSend) void run(text)
          }}
          placeholder={
            revising
              ? `Change ${currentVersion(revising).prompt?.trim() || revising.slug} (e.g. "thicker legs")…`
              : `Describe a ${CATEGORY_NOUN[category]}…`
          }
          aria-label="Describe a model"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-card px-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-hidden"
        />
        <fieldset className="flex shrink-0 items-center gap-0.5 border-0 p-0">
          {MODEL_CATEGORIES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={category === option.id}
              disabled={busy}
              onClick={() => setCategory(option.id)}
              className={cn(
                'h-8 rounded px-1.5 text-2xs transition-colors disabled:opacity-40',
                category === option.id
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
          disabled={!canSend}
          onClick={() => void run(text)}
          title={
            revising
              ? `Add this change as the next version of ${revising.slug}`
              : `Create a new ${CATEGORY_NOUN[category]}`
          }
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Sparkles size={12} aria-hidden="true" /> : <Zap size={12} aria-hidden="true" />}
          {busy ? 'Designing…' : revising ? 'Apply' : 'Make it'}
        </button>
      </div>
      {error && <p className="pt-1 text-3xs leading-relaxed text-destructive">{error}</p>}
    </div>
  )
}
