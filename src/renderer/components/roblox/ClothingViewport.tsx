/**
 * The garment the Roblox page shows in 3D, and the facts about it.
 *
 * The collection list lives in the Side panel, so this reads the pick from the
 * selection store rather than from a parent's props. One `ArtifactViewportPanel`
 * per page: `ArtifactViewport` is deliberately per-instance, because a shared
 * WebGL surface was the cause of three separate bugs (commit 640ed56e, D13).
 */

import { useEffect, useMemo } from 'react'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { ClothingArtifact } from '@/lib/generator/viewport/artifact'
import {
  useProjectRecords,
  useRecordAtlas,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import { usePickedSlug } from '@/stores/roblox-selection-store'

const TYPES = ['shirt', 'pants', 'tshirt'] as const

function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
}

function typeOf(record: ArtifactRecord): DesignType {
  const design = currentVersion(record).design as { type?: unknown } | undefined
  return isDesignType(design?.type) ? design.type : 'shirt'
}

interface ClothingViewportProps {
  projectPath: string
}

export function ClothingViewport({ projectPath }: ClothingViewportProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  const active = useMemo(() => {
    if (!records || records.length === 0) return null
    return records.find((record) => record.slug === picked) ?? records[0] ?? null
  }, [records, picked])

  const atlas = useRecordAtlas(projectPath, active)
  const version = active ? currentVersion(active) : null

  const artifact = useMemo<ClothingArtifact | null>(() => {
    if (!active || !atlas) return null
    return {
      kind: 'clothing',
      type: typeOf(active),
      atlas,
      name: version?.prompt?.trim() || active.slug
    }
  }, [active, atlas, version])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
  )
}
