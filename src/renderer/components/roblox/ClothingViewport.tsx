/**
 * The garment the Roblox page shows in 3D, and the facts about it.
 *
 * The collection list lives in the Side panel, so this reads the pick from the
 * selection store rather than from a parent's props. One `ArtifactViewportPanel`
 * per page: `ArtifactViewport` is deliberately per-instance, because a shared
 * WebGL surface was the cause of three separate bugs (commit 640ed56e, D13).
 *
 * The atlas is decoded twice for two different reasons: the viewport wants it as
 * a texture, and the Inspector wants its alpha channel to say which regions the
 * design actually painted. Both come from the one data URL the records store
 * already holds, so no extra file read is involved.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  type ArtifactRecord,
  currentVersion,
  isModelRecord,
  type RecordVersion,
  restoreVersion
} from '@/lib/artifact-records'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { OutfitArtifact } from '@/lib/generator/viewport/artifact'
import { type PaintReport, paintedByRegion, paintReport } from '@/lib/roblox-inspector'
import { cn } from '@/lib/utils'
import {
  pictureKey,
  useProjectRecords,
  useRecordAtlas,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import {
  isPicked,
  pickSlug,
  useIsDraft,
  usePickedSlug,
  useWornKeys
} from '@/stores/roblox-selection-store'
import { progressLine, type StageSnapshot, useStage } from '@/stores/roblox-stage-store'
import { ClothingComposer } from './ClothingComposer'
import { NodePipeline } from './NodePipeline'
import { RobloxInspector, type TabId } from './RobloxInspector'

const TYPES = ['shirt', 'pants', 'tshirt'] as const

function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
}

/**
 * A path as a person reads it.
 *
 * The records store normalises a Windows root to forward slashes, which turns a
 * verbatim prefix into `//?/`. That is correct for the fs plugin and wrong on
 * screen, so the display drops it and goes back to backslashes.
 */
function displayPath(path: string): string {
  return path.replace(/^\/\/\?\//, '').replace(/\//g, '\\')
}

function typeOf(record: ArtifactRecord): DesignType {
  const design = currentVersion(record).design as { type?: unknown } | undefined
  return isDesignType(design?.type) ? design.type : 'shirt'
}

/** Decode an atlas and report what each region actually paints. */
async function measurePaint(atlas: string, type: DesignType): Promise<PaintReport | null> {
  const image = new Image()
  image.src = atlas
  try {
    await image.decode()
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  return paintReport(type, paintedByRegion(type, data, canvas.width, canvas.height))
}

interface ClothingViewportProps {
  projectPath: string
}

/**
 * The middle of the page: the 3D avatar, the flat sheet, or the fold between
 * them.
 *
 * Which one is showing follows the stage phase, not a boolean: a revision passes
 * through `unwrap` (the avatar lying flat), `draw` (the new sheet growing) and
 * `wrap` (the result standing up), and only the phase knows which half of the
 * motion the user is in.
 */
function SheetStage({
  stage,
  artifact,
  active,
  draft,
  version
}: {
  stage: StageSnapshot
  artifact: OutfitArtifact | null
  active: ArtifactRecord | null
  draft: boolean
  version: RecordVersion | null
}): React.JSX.Element {
  const placeholder = active
    ? `Reading v${version?.n ?? 1}.`
    : draft
      ? 'Describe a garment below and press Make it.'
      : 'Pick a garment in the Roblox panel to see it in 3D.'

  const running = stage.state === 'running'
  const sheet = stage.sheet ?? stage.base

  if (running && sheet) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0e0f13] p-3">
        <img
          // A new key remounts the image, which restarts the entrance. Without it
          // the unfold and the first drawn layer would share one element and the
          // second beat would never play.
          key={stage.sheet ? 'drawing' : 'unfolding'}
          src={sheet}
          alt={stage.sheet ? 'The garment being drawn' : 'The garment lying flat'}
          className="max-h-full max-w-full object-contain animate-fold-lands motion-reduce:animate-none"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    )
  }

  return (
    <div
      // The avatar leaves by folding away, so the handover to the sheet is one
      // motion. Keyed by phase so re-entering `unwrap` plays it again.
      key={stage.phase === 'wrap' ? 'wrapping' : 'still'}
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        stage.phase === 'unwrap' && 'animate-fold-away motion-reduce:animate-none'
      )}
    >
      <ArtifactViewportPanel
        artifact={artifact}
        placeholder={placeholder}
        className="min-h-0 flex-1"
      />
    </div>
  )
}

export function ClothingViewport({ projectPath }: ClothingViewportProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const draft = useIsDraft(projectPath)
  const wornKeys = useWornKeys(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)
  const refresh = useRobloxRecordsStore((state) => state.refresh)
  const stage = useStage(projectPath)
  const [paint, setPaint] = useState<PaintReport | null>(null)
  const [tab, setTab] = useState<TabId>('Checks')
  /**
   * Whether the canvas previews the whole outfit instead of the picked garment.
   *
   * Preview only: it never touches the prompt, so turning it on cannot change what
   * a generation produces. Off by default, because RobloxKit's canvas holds one
   * item and a garment the user just made should not appear wearing others.
   */
  const [previewOutfit, setPreviewOutfit] = useState(false)

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  /**
   * The record on screen: the pick, else the newest garment.
   *
   * An explicit pick never silently becomes a different record. It used to fall
   * back to `records[0]` when the picked slug was not in the list yet, which is
   * the normal state right after a generation lands - the pick arrives before the
   * refresh does - so the page opened a garment the user never picked.
   *
   * Records are filtered to garments first: one project holds clothing and 3D
   * models in the same list, so an unfiltered `records[0]` put a model on the
   * clothing page as soon as a model was newer than the last garment.
   */
  const active = useMemo(() => {
    if (draft) return null
    const garments = (records ?? []).filter((record) => !isModelRecord(record))
    if (garments.length === 0) return null
    if (!picked) return garments[0] ?? null
    return garments.find((record) => isPicked(picked, record)) ?? null
  }, [draft, records, picked])

  const atlas = useRecordAtlas(projectPath, active)
  const version = active ? currentVersion(active) : null
  const type = active ? typeOf(active) : 'shirt'
  const allAtlases = useRobloxRecordsStore((state) => state.atlases)

  /**
   * The records the outfit preview wears, exactly as the user marked them.
   *
   * Not "the newest of each kind": nothing on disk pairs a shirt with its
   * trousers, so that guess put a garment the user was not looking at into the
   * outfit. The marks live in the selection store, one per row.
   */
  const outfitPieces = useMemo(() => {
    if (!previewOutfit || !records) return []
    const worn = new Set(wornKeys)
    return records
      .filter((record) => worn.has(`${record.kind}:${record.slug}`))
      .map((record) => [typeOf(record), record] as const)
  }, [previewOutfit, records, wornKeys])

  /**
   * What the canvas draws.
   *
   * The record on screen always keeps its own slot: opening an old shirt and
   * turning the outfit on used to replace that shirt with whichever shirt was
   * marked, so an older item silently showed the newest one. The marks only fill
   * the slots the open record does not occupy.
   */
  const artifact = useMemo<OutfitArtifact | null>(() => {
    if (!active || !atlas) return null
    const atlases: Partial<Record<DesignType, string>> = { [type]: atlas }
    for (const [kind, record] of outfitPieces) {
      if (kind === type) continue
      const key = pictureKey(projectPath, record.slug, currentVersion(record).n)
      const piece = allAtlases[key]
      if (piece) atlases[kind] = piece
    }
    return {
      kind: 'clothing',
      atlases,
      primary: type,
      // In the outfit preview the caption names the slots, so the page says what
      // it is showing instead of only naming the record the panel is about.
      name: Object.keys(atlases).length > 1 ? undefined : version?.prompt?.trim() || active.slug
    }
  }, [active, atlas, type, version, outfitPieces, allAtlases, projectPath])

  useEffect(() => {
    if (!atlas || !active) {
      setPaint(null)
      return
    }
    let cancelled = false
    void measurePaint(atlas, type).then((result) => {
      if (!cancelled) setPaint(result)
    })
    return () => {
      cancelled = true
    }
  }, [atlas, active, type])

  /**
   * Move the pointer, then re-read the project so the viewport, the collection
   * row and the Inspector all follow from one source. A refusal is thrown, not
   * swallowed: the Versions tab shows the reason, and a silent failure would
   * leave the user thinking the restore worked.
   */
  const handleRestore = async (n: number): Promise<void> => {
    if (!active) return
    const outcome = await restoreVersion(active, n)
    if (!outcome.ok) throw new Error(outcome.message)
    refresh(projectPath)
  }

  const progress = progressLine(stage)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <NodePipeline
          record={active}
          version={version}
          paint={paint}
          stage={stage}
          onOpenTab={setTab}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* D12 + the revision transition. A fresh garment is a blank template,
              then a 2D sheet growing, then the finished 3D avatar. A revision
              starts from the avatar already on screen, so it lies flat into the
              sheet it came from, draws, and the result folds back up - the same
              fold in both directions, so the two halves read as one motion.
              The sheet replaces the viewport while it draws because a
              half-dressed avatar cannot show progress: the layers land on the
              flat atlas, not on the model. */}
          <SheetStage
            stage={stage}
            artifact={artifact}
            active={active}
            draft={draft}
            version={version}
          />
          {progress && (
            <p
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-2xs text-warning"
            >
              {progress}
            </p>
          )}
        </div>
        {active && version ? (
          <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-2xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Checks</dt>
              <dd className={version.ok === false ? 'text-destructive' : 'text-success'}>
                {version.ok === false ? 'failed' : 'ready'}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Versions</dt>
              <dd className="tabular-nums">{active.versions.length}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Current</dt>
              <dd className="tabular-nums">v{version.n}</dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt>At</dt>
              <dd className="truncate font-mono">{displayPath(active.dir)}</dd>
            </div>
            <button
              type="button"
              aria-pressed={previewOutfit}
              onClick={() => setPreviewOutfit((on) => !on)}
              title={
                previewOutfit
                  ? 'The canvas is previewing the whole outfit'
                  : 'Preview the whole outfit: one garment per kind, newest first'
              }
              className={cn(
                'rounded px-1.5 py-0.5 text-2xs transition-colors',
                previewOutfit
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {previewOutfit ? 'Outfit: on' : 'Outfit: off'}
            </button>
          </dl>
        ) : null}
        <ClothingComposer
          projectPath={projectPath}
          record={active}
          type={type}
          baseAtlas={atlas}
          draft={draft}
          onSettled={(slug) => {
            // Read the project first, then pick: the pick names a record that
            // only exists after the re-read, and picking first left the page on
            // whatever record happened to be newest.
            refresh(projectPath).then(() => pickSlug(projectPath, slug))
          }}
        />
      </div>

      <RobloxInspector
        record={active}
        version={version}
        paint={paint}
        onRestore={handleRestore}
        tab={tab}
        onTabChange={setTab}
      />
    </div>
  )
}
