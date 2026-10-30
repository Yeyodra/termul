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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Zap } from '@/components/icons'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import { pngDataUrl } from '@/lib/generator/engines/clothing/png'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import type { OutfitCompanion } from '@/lib/generator/tools/generate-clothing'
import { runPageGeneration } from '@/lib/roblox-generate'
import { cn } from '@/lib/utils'
import { useProjectRecords } from '@/stores/roblox-records-store'
import { useStageStore } from '@/stores/roblox-stage-store'

/**
 * The kinds the picker offers.
 *
 * T-shirt is left out on purpose: it is a real Roblox asset (512x512, one picture
 * on the chest, its own upload tab), but it is a third button nobody pressed and
 * it reads as a duplicate of Shirt. Records already on disk still open and render;
 * only the picker hides it.
 */
const TYPES: Array<{ id: DesignType; label: string }> = [
  { id: 'shirt', label: 'Shirt' },
  { id: 'pants', label: 'Pants' }
]

const KIND_NOUN: Record<DesignType, string> = {
  shirt: 'shirt',
  pants: 'pair of pants',
  tshirt: 't-shirt'
}

const ALL_KINDS: DesignType[] = ['shirt', 'pants', 'tshirt']

function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (ALL_KINDS as string[]).includes(value)
}

/** How long the fold back into 3D plays; must match `fold-lands` in index.css. */
const FOLD_MS = 320

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
  /** The atlas on screen, so a revision can unfold from it instead of blanking. */
  baseAtlas?: string
  /**
   * Whether the page is on a blank garment because the user pressed New.
   *
   * New means a clean slate: the project may hold a whole outfit, and none of it
   * belongs in a garment the user asked to start from nothing. Picking a
   * different kind while a record is open is the opposite case - that record *is*
   * the outfit the new garment has to match - so the two cannot be told apart by
   * `record` alone, which is null in both.
   */
  draft?: boolean
  onStage?: (stage: string) => void
  /** Called with the slug the host wrote and whether it started from New. */
  onSettled?: (slug: string, fresh: boolean) => void
}

/**
 * One button, one rule: the picker decides the kind, and what happens next follows
 * from it.
 *
 * This used to be two buttons with different meanings - `Apply` revised the open
 * record under ITS kind, `Make it` made a new one under the PICKER's kind - so
 * "pick Pants, press Apply" silently produced a shirt, and Enter did whichever of
 * the two the open record implied. Which garment you get should never depend on
 * which button you pressed.
 *
 * So: the kind is the picker's, always. If a record of that kind is open, the
 * prompt is a revision of it and lands as its next version. If a record of another
 * kind is open, or none is, the prompt makes a new garment of the picked kind.
 */
export function ClothingComposer({
  projectPath,
  record,
  type = 'shirt',
  baseAtlas,
  draft = false,
  onStage,
  onSettled
}: ClothingComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<DesignType>(type)
  /**
   * Whether a new garment should be told about the rest of the outfit.
   *
   * Off by default, because RobloxKit has no such feature and an automatic
   * version put clothes the user never mentioned onto a fresh garment. Turning it
   * on is how "make trousers that match this shirt" is asked for.
   */
  const [matchOutfit, setMatchOutfit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const allRecords = useProjectRecords(projectPath)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const canSend = text.trim().length > 0 && !busy

  /**
   * Opening a record points the picker at its kind, so the action reads "Apply"
   * rather than offering to make a second garment of the same kind.
   *
   * Only while a record is open: running this when the record became null put the
   * closed record's kind back, so choosing Pants after closing a shirt sent
   * `type: "shirt"` and the trousers came out as a shirt.
   */
  const openSlug = record?.slug
  const openKind = record?.kind
  useEffect(() => {
    if (!openSlug || !openKind) return
    setKind(openKind as DesignType)
  }, [openSlug, openKind])

  /** The record this prompt revises: only one of the picked kind, if any. */
  const revising = record && record.kind === kind ? record : null

  /**
   * Every garment the outfit already wears, one per kind.
   *
   * The record on screen wins its own kind: "match the shirt" means the shirt the
   * user is looking at, and taking the newest shirt instead matched a garment
   * they were not looking at. The rest fall back to the newest of their kind,
   * because that is the one the viewport wears. Keyed by kind rather than slug
   * because the same slug exists under two kinds - `shirt/kemeja-bunga-hijau` and
   * `pants/kemeja-bunga-hijau` are both real.
   */
  const worn = useMemo<OutfitCompanion[]>(() => {
    const byKind = new Map<DesignType, OutfitCompanion>()
    if (record) {
      const version = currentVersion(record)
      const design = version.design as { type?: unknown } | undefined
      const kindOfRecord = isDesignType(design?.type) ? design.type : null
      if (kindOfRecord) {
        byKind.set(kindOfRecord, {
          type: kindOfRecord,
          name: version.prompt?.trim() || record.slug,
          design: version.design
        })
      }
    }
    for (const one of allRecords ?? []) {
      const version = currentVersion(one)
      const design = version.design as { type?: unknown } | undefined
      const kindOfOne = isDesignType(design?.type) ? design.type : null
      if (!kindOfOne || byKind.has(kindOfOne)) continue
      byKind.set(kindOfOne, {
        type: kindOfOne,
        name: version.prompt?.trim() || one.slug,
        design: version.design
      })
    }
    return [...byKind.values()]
  }, [allRecords, record])

  /**
   * The garments a new one has to match: everything worn except the kind being
   * made, capped at two so the prompt stays small.
   *
   * Excluding the kind being MADE, not the open record's kind, is the difference
   * between matching and not: making pants while a shirt was open used to exclude
   * shirts, so the trousers arrived with no idea what they had to match.
   */
  const companionsFor = (made: DesignType): OutfitCompanion[] =>
    worn.filter((one) => one.type !== made).slice(0, 2)

  /**
   * Run one prompt against the kind the picker shows.
   *
   * A revision is decided here, not by the caller: if a record of the picked kind
   * is open, the prompt revises it and lands as its next version; otherwise it
   * makes a new garment of that kind. `recordSlug` is passed as a fact to the host
   * rather than asked for in the prompt, because "keep the same name" was only an
   * appeal and a renamed garment became a second record with an empty history.
   */
  const run = async (prompt: string): Promise<void> => {
    if (!prompt.trim() || busy) return
    const kindForRun: DesignType = kind
    const revising = record && record.kind === kindForRun ? record : null
    setBusy(true)
    setError(null)
    // A revision unfolds the avatar already on screen instead of blanking; a
    // fresh garment has no sheet to unfold, so it starts drawing straight away.
    useStageStore.getState().set(projectPath, {
      state: 'running',
      phase: revising ? 'unwrap' : 'draw',
      stage: 'Design',
      layer: 0,
      total: 0,
      sheet: null,
      base: revising ? (baseAtlas ?? null) : null,
      error: null
    })
    onStage?.('running')
    try {
      const outcome = await runPageGeneration({
        projectPath,
        prompt: revising ? revisionPrompt(revising, prompt) : prompt.trim(),
        type: kindForRun,
        recordSlug: revising?.slug,
        // New is a clean slate: no outfit goes into a garment the user asked to
        // start from nothing. Every other run matches what is already worn, which
        // is the whole point of making the second piece.
        companions: matchOutfit ? companionsFor(kindForRun) : [],
        onStage: (stage) => {
          useStageStore.getState().set(projectPath, { stage })
          if (mounted.current) onStage?.(stage)
        },
        onLayer: (drawn, total, canvas) => {
          useStageStore.getState().set(projectPath, {
            // The first layer ends the unfold and starts the new sheet.
            phase: 'draw',
            layer: drawn,
            total,
            // The sheet as it stands right now. D12: the page is a blank
            // template, then a 2D sheet growing, then the finished 3D avatar.
            sheet: canvas ? pngDataUrl(canvas as Parameters<typeof pngDataUrl>[0]) : null
          })
        }
      })
      if (outcome.status === 'done') {
        // `wrap` first, then `done` once the fold has played: the sheet stands
        // back up into the new avatar instead of cutting to it. The stage store
        // is keyed by project, so this runs even when the component unmounted -
        // leaving the page mid-draw used to show "drawing" over a garment that
        // had already landed.
        useStageStore.getState().set(projectPath, { phase: 'wrap' })
        window.setTimeout(() => {
          useStageStore.getState().set(projectPath, {
            state: 'done',
            phase: 'idle',
            stage: 'Ready',
            sheet: null,
            base: null
          })
        }, FOLD_MS)
        // Outside the mount guard on purpose: the pick and the stage belong to the
        // project, so a garment that landed while the page was closed still opens
        // when the user comes back. Only this component's own state is guarded.
        onSettled?.(outcome.saved.slug, draft)
        if (mounted.current) setText('')
      } else if (outcome.status === 'failed') {
        useStageStore.getState().set(projectPath, {
          state: 'error',
          phase: 'idle',
          base: null,
          error: outcome.error
        })
        if (mounted.current) setError(outcome.error)
      } else {
        useStageStore.getState().set(projectPath, {
          state: 'idle',
          phase: 'idle',
          layer: 0,
          total: 0,
          sheet: null,
          base: null
        })
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
              ? `Change ${currentVersion(revising).prompt?.trim() || revising.slug} (e.g. "thinner stripes")…`
              : `Describe a ${KIND_NOUN[kind]}…`
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
          aria-pressed={matchOutfit}
          disabled={busy || worn.length === 0}
          onClick={() => setMatchOutfit((on) => !on)}
          title={
            worn.length === 0
              ? 'Nothing else in this project to match'
              : matchOutfit
                ? 'The new garment is told about the outfit'
                : 'Match the outfit: tell the model what is already worn'
          }
          className={cn(
            'h-8 shrink-0 rounded px-1.5 text-2xs transition-colors disabled:opacity-40',
            matchOutfit
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Match outfit
        </button>
        <button
          type="button"
          disabled={!canSend || busy}
          onClick={() => void run(text)}
          title={
            revising
              ? `Add this change as the next version of ${revising.slug}`
              : `Create a new ${KIND_NOUN[kind]}`
          }
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Sparkles size={12} aria-hidden="true" /> : <Zap size={12} aria-hidden="true" />}
          {busy ? 'Drawing…' : revising ? 'Apply' : 'Make it'}
        </button>
      </div>
      {error && <p className="pt-1 text-3xs leading-relaxed text-destructive">{error}</p>}
    </div>
  )
}
