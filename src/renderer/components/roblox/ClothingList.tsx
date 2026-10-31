/**
 * The garment collection, in the Side panel (D2).
 *
 * The list and the viewport used to share one component, so the pick was a
 * `useState`. They now live in different subtrees â€” the list here, the viewport
 * in the page â€” so the pick goes through `roblox-selection-store` instead.
 *
 * Thumbnails come from the records store: the list shows the still, the page
 * shows the atlas, and both are read once per version. Reading them per
 * component would pull the same PNG twice through the brokered binary path.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Layers, Plus } from '@/components/icons'
import { type ArtifactRecord, currentVersion, recordsFor } from '@/lib/artifact-records'
import {
  DEFAULT_ROBLOX_FEATURE,
  featurePath,
  kindLabel,
  type RobloxFeature
} from '@/lib/roblox-features'
import { cn } from '@/lib/utils'
import {
  useProjectRecords,
  useRecordStill,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import {
  isPicked,
  pickSlug,
  startDraft,
  toggleWorn,
  usePickedSlug,
  useWornKeys
} from '@/stores/roblox-selection-store'
import { RobloxGenerators } from './RobloxGenerators'

interface ClothingRowProps {
  projectPath: string
  record: ArtifactRecord
  active: boolean
  worn: boolean
  onPick: (slug: string) => void
}

/**
 * One garment in the collection.
 *
 * The check on the left marks it for the outfit preview. It has to be a per-row
 * mark: nothing on disk says which trousers belong with which shirt, so the
 * pairing is the user's to make, and "newest of each kind" guessed wrong.
 */
function ClothingRow({
  projectPath,
  record,
  active,
  worn,
  onPick
}: ClothingRowProps): React.JSX.Element {
  const still = useRecordStill(projectPath, record)
  const version = currentVersion(record)
  const label = version.prompt?.trim() || record.slug

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={worn}
        aria-label={`Wear ${label} in the outfit preview`}
        title={worn ? 'Worn in the outfit preview' : 'Wear in the outfit preview'}
        onClick={() => toggleWorn(projectPath, record)}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded transition-colors',
          worn ? 'text-primary' : 'text-muted-foreground/40 hover:text-foreground'
        )}
      >
        {worn ? (
          <Check size={12} aria-hidden="true" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </button>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        title={version.prompt ? `${label}: ${version.prompt}` : label}
        onClick={() => onPick(record.slug)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded px-2 py-2 text-left transition-colors',
          active ? 'bg-muted shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/60'
        )}
      >
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-background">
          {still ? (
            <img src={still} alt="" className="size-full object-cover" />
          ) : (
            <Layers size={18} className="text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="mt-px block truncate font-mono text-2xs tracking-wide text-muted-foreground">
            {kindLabel(record.kind)} Â· v{version.n}
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
 *
 * Search and the kind filter are local state: they narrow what is on screen and
 * must not survive a project switch. The predicate is the same one RobloxKit
 * uses â€” name plus prompt as one haystack, AND the kind.
 */
export function ClothingList({
  projectPath,
  feature = DEFAULT_ROBLOX_FEATURE,
  onPickFeature
}: ClothingListProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const worn = useWornKeys(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  /**
   * Only the records this generator produced.
   *
   * The collection on disk is one tree per generator, but this panel read every
   * record and ignored which feature was open, so the 3D page listed shirts and
   * the clothing page listed models. Everything below - the rows, the counts, the
   * kind filter and the empty state - reads from `mine`, so a page cannot show a
   * record it has no viewport for.
   */
  const mine = useMemo(() => recordsFor(records, feature), [records, feature])

  const kinds = useMemo(() => [...new Set(mine.map((record) => record.kind))].sort(), [mine])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return mine.filter((record) => {
      if (kind !== 'all' && record.kind !== kind) return false
      if (!needle) return true
      const version = currentVersion(record)
      const haystack = `${version.prompt ?? ''} ${record.slug}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [mine, query, kind])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
      <RobloxGenerators current={feature} onPick={(next) => onPickFeature?.(next)} />

      <div className="mx-2 my-2 h-px bg-border/60" />

      {records === undefined ? (
        <p className="px-4 text-xs text-muted-foreground">Reading the collection…</p>
      ) : mine.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          {feature === '3d'
            ? 'No model yet. Describe one on the page, or ask the agent, and it lands here with every version.'
            : 'No garment yet. Ask the agent for one and it lands here, with every version.'}
        </p>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex flex-col gap-1.5 bg-background px-2 pb-1.5">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search designsâ€¦"
              aria-label="Search designs"
              className="h-7 w-full rounded-md border border-border/60 bg-card px-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-hidden"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs text-muted-foreground">
                {shown.length} {shown.length === 1 ? 'item' : 'items'}
              </span>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-2xs text-muted-foreground">
                  <span className="sr-only">Filter by kind</span>
                  <select
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                    className="h-6 rounded border border-border/60 bg-card px-1 text-2xs text-foreground focus-visible:border-ring focus-visible:outline-hidden"
                  >
                    <option value="all">All kinds</option>
                    {kinds.map((entry) => (
                      <option key={entry} value={entry}>
                        {kindLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    startDraft(projectPath)
                    navigate(featurePath(feature))
                  }}
                  title="Start a new garment"
                  className="flex h-6 items-center gap-1 rounded border border-border/60 px-1.5 text-2xs text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus size={10} aria-hidden="true" />
                  New
                </button>
              </div>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="px-4 pt-1 text-xs text-muted-foreground">Nothing matches that search.</p>
          ) : (
            <ul aria-label="Collection" className="flex flex-col gap-0.5 px-2">
              {shown.map((record) => (
                <ClothingRow
                  key={`${record.kind}:${record.slug}`}
                  projectPath={projectPath}
                  record={record}
                  active={
                    picked && mine.some((one) => isPicked(picked, one))
                      ? isPicked(picked, record)
                      : // Either nothing was picked, or the pick names a record that
                        // is gone: the page falls back to the newest of this
                        // generator, so the row that is open has to say so instead
                        // of leaving every row unmarked.
                        record === mine[0]
                  }
                  worn={worn.includes(`${record.kind}:${record.slug}`)}
                  onPick={(slug) => {
                    pickSlug(projectPath, slug, record.kind)
                    // RobloxKit's row opens the item in the page, so the click
                    // lands somewhere. Without this the pick only changed a
                    // highlight in a panel the user was already looking at.
                    navigate(featurePath(feature))
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
