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
import { type ArtifactRecord, currentVersion, restoreVersion } from '@/lib/artifact-records'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { ClothingArtifact } from '@/lib/generator/viewport/artifact'
import { type PaintReport, paintedByRegion, paintReport } from '@/lib/roblox-inspector'
import {
  useProjectRecords,
  useRecordAtlas,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import { usePickedSlug } from '@/stores/roblox-selection-store'
import { RobloxInspector } from './RobloxInspector'

const TYPES = ['shirt', 'pants', 'tshirt'] as const

function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
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

export function ClothingViewport({ projectPath }: ClothingViewportProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)
  const refresh = useRobloxRecordsStore((state) => state.refresh)
  const [paint, setPaint] = useState<PaintReport | null>(null)

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  const active = useMemo(() => {
    if (!records || records.length === 0) return null
    return records.find((record) => record.slug === picked) ?? records[0] ?? null
  }, [records, picked])

  const atlas = useRecordAtlas(projectPath, active)
  const version = active ? currentVersion(active) : null
  const type = active ? typeOf(active) : 'shirt'

  const artifact = useMemo<ClothingArtifact | null>(() => {
    if (!active || !atlas) return null
    return {
      kind: 'clothing',
      type,
      atlas,
      name: version?.prompt?.trim() || active.slug
    }
  }, [active, atlas, type, version])

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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ArtifactViewportPanel
          artifact={artifact}
          placeholder={
            active
              ? `Reading v${version?.n ?? 1}…`
              : 'Pick a garment in the Roblox panel to see it in 3D.'
          }
          className="min-h-0 flex-1"
        />
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
              <dd className="truncate font-mono">{active.dir}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <RobloxInspector record={active} version={version} paint={paint} onRestore={handleRestore} />
    </div>
  )
}
