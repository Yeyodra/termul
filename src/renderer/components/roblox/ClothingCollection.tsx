import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ArtifactRecord,
  currentVersion,
  loadArtifactRecords,
  type RecordVersion,
  readAtlasDataUrl,
  readStillDataUrl
} from '@/lib/artifact-records'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { ClothingArtifact } from '@/lib/generator/viewport/artifact'
import { cn } from '@/lib/utils'

interface ClothingCollectionProps {
  projectPath: string
}

const TYPES = ['shirt', 'pants', 'tshirt'] as const

function isDesignType(value: unknown): value is DesignType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
}

function typeOf(record: ArtifactRecord): DesignType {
  const version = currentVersion(record)
  const design = version.design as { type?: unknown } | undefined
  return isDesignType(design?.type) ? design.type : 'shirt'
}

function labelOf(record: ArtifactRecord, version: RecordVersion): string {
  return version.prompt?.trim() || record.slug
}

export function ClothingCollection({ projectPath }: ClothingCollectionProps): React.JSX.Element {
  const [records, setRecords] = useState<ArtifactRecord[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [artifacts, setArtifacts] = useState<Record<string, ClothingArtifact>>({})
  const [stills, setStills] = useState<Record<string, string>>({})

  const reload = useCallback(() => {
    let cancelled = false
    void loadArtifactRecords(projectPath).then((loaded) => {
      if (cancelled) return
      setRecords(loaded)
      setSelected((current) => current ?? loaded[0]?.slug ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  useEffect(() => reload(), [reload])

  useEffect(() => {
    if (!records) return
    let cancelled = false
    for (const record of records) {
      const version = currentVersion(record)
      const key = `${record.slug}@${version.n}`
      if (artifacts[key] || stills[key]) continue
      void readAtlasDataUrl(record, version).then((atlas) => {
        if (cancelled || !atlas) return
        setArtifacts((current) => ({
          ...current,
          [key]: {
            kind: 'clothing',
            type: typeOf(record),
            atlas,
            name: version.prompt?.trim() || record.slug
          }
        }))
      })
      void readStillDataUrl(record, version).then((still) => {
        if (cancelled || !still) return
        setStills((current) => ({ ...current, [key]: still }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [records, artifacts, stills])

  const active = useMemo(
    () => records?.find((record) => record.slug === selected) ?? null,
    [records, selected]
  )
  const activeVersion = active ? currentVersion(active) : null
  const activeKey = active && activeVersion ? `${active.slug}@${activeVersion.n}` : null
  const artifact = activeKey ? (artifacts[activeKey] ?? null) : null

  if (records === null) {
    return <p className="m-auto text-xs text-muted-foreground">Reading the collection…</p>
  }

  if (records.length === 0) {
    return (
      <div className="m-auto max-w-sm text-center">
        <p className="text-xs text-muted-foreground">
          No garment yet. Ask the agent for one and it lands here, with every version.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ul
        aria-label="Collection"
        className="flex w-[236px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-2"
      >
        <li className="px-2 py-1 text-2xs text-muted-foreground">
          {records.length} {records.length === 1 ? 'item' : 'items'}
        </li>
        {records.map((record) => {
          const version = currentVersion(record)
          const still = stills[`${record.slug}@${version.n}`]
          const isActive = record.slug === selected
          return (
            <li key={record.slug}>
              <button
                type="button"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setSelected(record.slug)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  isActive ? 'bg-muted' : 'hover:bg-muted/60'
                )}
              >
                <span className="size-7 shrink-0 overflow-hidden rounded border border-border/60 bg-background">
                  {still ? <img src={still} alt="" className="size-full object-cover" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {labelOf(record, version)}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {typeOf(record)} · v{version.n}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex min-w-0 flex-1 flex-col">
        <ArtifactViewportPanel
          artifact={artifact}
          placeholder={
            active && !artifact
              ? `Reading v${activeVersion?.n ?? 1}…`
              : 'Pick a garment to see it in 3D.'
          }
          className="min-h-0 flex-1"
        />
        {active && activeVersion ? (
          <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-2xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Checks</dt>
              <dd className={activeVersion.ok === false ? 'text-destructive' : 'text-success'}>
                {activeVersion.ok === false ? 'failed' : 'ready'}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Versions</dt>
              <dd className="tabular-nums">{active.versions.length}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Current</dt>
              <dd className="tabular-nums">v{activeVersion.n}</dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt>At</dt>
              <dd className="truncate font-mono">{active.dir}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  )
}
