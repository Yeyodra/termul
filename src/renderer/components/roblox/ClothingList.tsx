/**
 * The garment collection, in the Side panel (D2).
 *
 * The list and the viewport used to share one component, so the pick was a
 * `useState`. They now live in different subtrees — the list here, the viewport
 * in the page — so the pick goes through `roblox-selection-store` instead.
 *
 * Thumbnails come from the records store: the list shows the still, the page
 * shows the atlas, and both are read once per version. Reading them per
 * component would pull the same PNG twice through the brokered binary path.
 */

import { useEffect } from 'react'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import { DEFAULT_ROBLOX_FEATURE, type RobloxFeature } from '@/lib/roblox-features'
import { cn } from '@/lib/utils'
import {
  useProjectRecords,
  useRecordStill,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import { pickSlug, usePickedSlug } from '@/stores/roblox-selection-store'
import { RobloxGenerators } from './RobloxGenerators'

interface ClothingRowProps {
  projectPath: string
  record: ArtifactRecord
  active: boolean
  onPick: (slug: string) => void
}

function ClothingRow({ projectPath, record, active, onPick }: ClothingRowProps): React.JSX.Element {
  const still = useRecordStill(projectPath, record)
  const version = currentVersion(record)
  const label = version.prompt?.trim() || record.slug

  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => onPick(record.slug)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          active ? 'bg-muted' : 'hover:bg-muted/60'
        )}
      >
        <span className="size-7 shrink-0 overflow-hidden rounded border border-border/60 bg-background">
          {still ? <img src={still} alt="" className="size-full object-cover" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-2xs text-muted-foreground">
            {record.kind} · v{version.n}
          </span>
        </span>
      </button>
    </li>
  )
}

interface ClothingListProps {
  projectPath: string
  feature?: RobloxFeature
  onPickFeature?: (feature: RobloxFeature) => void
}

/**
 * The Side panel body of the Roblox tab: the generator list, then the garments
 * the project holds. Both scroll in one container, as in the approved mockup.
 */
export function ClothingList({
  projectPath,
  feature = DEFAULT_ROBLOX_FEATURE,
  onPickFeature
}: ClothingListProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  const selected =
    picked && records?.some((record) => record.slug === picked) ? picked : records?.[0]?.slug

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
      <RobloxGenerators current={feature} onPick={(next) => onPickFeature?.(next)} />

      <div className="mx-2 my-2 h-px bg-border/60" />

      {records === undefined ? (
        <p className="px-4 text-xs text-muted-foreground">Reading the collection…</p>
      ) : records.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          No garment yet. Ask the agent for one and it lands here, with every version.
        </p>
      ) : (
        <>
          <p className="px-4 pb-1 text-2xs text-muted-foreground">
            {records.length} {records.length === 1 ? 'item' : 'items'}
          </p>
          <ul aria-label="Collection" className="flex flex-col gap-0.5 px-2">
            {records.map((record) => (
              <ClothingRow
                key={record.slug}
                projectPath={projectPath}
                record={record}
                active={record.slug === selected}
                onPick={(slug) => pickSlug(projectPath, slug)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
