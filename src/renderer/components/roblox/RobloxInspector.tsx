/**
 * The Inspector: what the current version actually is.
 *
 * Five tabs over data the host already wrote, so nothing here waits on a
 * generation. "Painted" is the one live number: it needs the atlas pixels, so
 * the caller hands them in after decoding the PNG it already read for the
 * viewport.
 *
 * Collapsible (O4): at 1024px the viewport is the scarce resource, and folding
 * 236px of Inspector back into it matters more than the 6px that separated the
 * two collection layouts ever did.
 *
 * **The tab set is a prop, not a module constant.** Three of the five tabs read
 * garment facts (`design.type`, `layers`, `regions`), so a 3D record would show
 * them empty. A second engine needs its own set, and a constant cannot be
 * changed by a caller.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { clipboardApi, openerApi } from '@/lib/api'
import {
  type ArtifactRecord,
  currentVersion,
  isModelRecord,
  isModelVersion,
  type RecordVersion,
  saveModel,
  savePng
} from '@/lib/artifact-records'
import { type PaintReport, versionFacts } from '@/lib/roblox-inspector'
import { recordPath } from '@/lib/roblox-record-path'
import { uploadModelRecord, uploadReadiness } from '@/lib/roblox-upload'
import { robloxApi } from '@/lib/tauri-roblox'
import { cn } from '@/lib/utils'

/** The clothing tabs, which is what an existing caller gets. */
export const CLOTHING_TABS = ['Checks', 'Regions', 'Layers', 'Versions', 'Use it'] as const
/** The 3D tabs: no regions or layers, because a model has neither. */
export const MODEL_TABS = ['Checks', 'Versions', 'Use it'] as const

export type TabId = (typeof CLOTHING_TABS)[number] | (typeof MODEL_TABS)[number] | 'Scene'

export const TABS = CLOTHING_TABS

const TAB_CLASS =
  'inline-flex h-[22px] items-center rounded px-1.5 text-[10px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground'
const TAB_ON = 'bg-muted text-foreground'
const SECTION_CLASS = 'mb-1.5 text-3xs font-semibold tracking-wide text-muted-foreground uppercase'
const ROW_CLASS = 'flex items-baseline justify-between gap-2 py-[3px]'
const KEY_CLASS = 'text-[10.5px] text-muted-foreground'
const VALUE_CLASS = 'text-[10.5px] font-medium tabular-nums'

function Checks({ version, paint }: { version: RecordVersion; paint: PaintReport | null }) {
  const facts = useMemo(() => versionFacts(version), [version])

  if (isModelVersion(version)) return <ModelChecks version={version} />

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] text-muted-foreground">
          Roblox&apos;s {facts.size.width}x{facts.size.height} classic template
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-semibold',
            facts.ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
          )}
        >
          {facts.ok ? 'Ready' : 'Failed'}
        </span>
      </div>
      <dl className="m-0">
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>Image</dt>
          <dd className={VALUE_CLASS}>
            {facts.size.width} x {facts.size.height} px
          </dd>
        </div>
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>Layers</dt>
          <dd className={VALUE_CLASS}>
            {facts.layerCount}
            <span className="text-muted-foreground"> / {facts.layerLimit}</span>
          </dd>
        </div>
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>Regions painted</dt>
          <dd className={VALUE_CLASS}>{paint ? `${paint.painted} / ${paint.total}` : '—'}</dd>
        </div>
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>Design</dt>
          <dd className={VALUE_CLASS}>{facts.readable ? facts.type : 'unreadable'}</dd>
        </div>
      </dl>
      {paint && paint.empty.length > 0 && (
        <p className="mt-2 text-3xs leading-relaxed text-muted-foreground">
          Skin shows on {paint.empty.length} region{paint.empty.length > 1 ? 's' : ''}:{' '}
          <span className="font-mono">{paint.empty.join(', ')}</span>
        </p>
      )}
    </div>
  )
}

function Regions({ version, paint }: { version: RecordVersion; paint: PaintReport | null }) {
  const facts = useMemo(() => versionFacts(version), [version])

  if (!facts.readable) {
    return <p className="text-[10.5px] text-muted-foreground">This version carries no design.</p>
  }

  return (
    <div>
      <p className={SECTION_CLASS}>Regions</p>
      <ul className="flex flex-col">
        {facts.regions.map((region) => {
          const bare = paint ? paint.empty.includes(region.id) : region.layers === 0
          return (
            <li key={region.id} className={ROW_CLASS}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    bare ? 'bg-destructive/60' : 'bg-success/70'
                  )}
                />
                <span className="truncate font-mono text-[10px]">{region.id}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {region.layers} layer{region.layers === 1 ? '' : 's'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Layers({ version }: { version: RecordVersion }) {
  const facts = useMemo(() => versionFacts(version), [version])

  if (facts.layers.length === 0) {
    return <p className="text-[10.5px] text-muted-foreground">This version carries no layers.</p>
  }

  return (
    <div>
      <p className={SECTION_CLASS}>{facts.layerCount} layers, painted in order</p>
      <ol className="flex flex-col">
        {facts.layers.map((layer) => (
          <li
            key={layer.n}
            className={cn(
              'flex items-center gap-2 rounded px-1 py-[3px]',
              layer.hidden && 'opacity-40'
            )}
          >
            <span className="w-5 shrink-0 font-mono text-[9.5px] text-muted-foreground tabular-nums">
              {layer.n}
            </span>
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm border border-border/60"
              style={layer.color ? { backgroundColor: layer.color } : undefined}
            />
            <span className="min-w-0 flex-1 truncate text-[10.5px]">{layer.kind}</span>
            <span className="shrink-0 truncate font-mono text-[9.5px] text-muted-foreground">
              {layer.target}
            </span>
            {layer.opacity !== null && layer.opacity < 1 && (
              <span className="shrink-0 text-[9.5px] text-muted-foreground tabular-nums">
                {Math.round(layer.opacity * 100)}%
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Versions({
  record,
  current,
  onRestore
}: {
  record: ArtifactRecord
  current: RecordVersion
  onRestore?: (n: number) => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const restore = async (n: number): Promise<void> => {
    if (!onRestore || busy !== null) return
    setBusy(n)
    setError(null)
    try {
      await onRestore(n)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className={SECTION_CLASS}>Versions</p>
      <ul className="flex flex-col gap-0.5">
        {[...record.versions].reverse().map((version) => {
          const isCurrent = version.n === current.n
          return (
            <li
              key={version.n}
              aria-current={isCurrent ? 'true' : undefined}
              className={cn(
                'flex items-center gap-2 rounded border border-transparent px-1.5 py-1.5',
                isCurrent && 'border-border bg-muted'
              )}
            >
              <span className="w-5 shrink-0 font-mono text-[10px] font-semibold text-secondary-foreground">
                v{version.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px]">
                  {version.prompt?.trim() || record.slug}
                </span>
                <span className="block text-3xs text-muted-foreground">
                  {new Date(version.at).toLocaleDateString()}
                </span>
              </span>
              {isCurrent ? (
                <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-3xs font-semibold tracking-wide text-primary uppercase">
                  Current
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!onRestore || busy !== null}
                  onClick={() => void restore(version.n)}
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-3xs text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                >
                  {busy === version.n ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {error && (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-3xs leading-relaxed text-destructive">
          {error}
        </p>
      )}
      <p className="mt-2 text-3xs leading-relaxed text-muted-foreground">
        Restoring moves the pointer to that version. It does not re-render: the viewport draws the
        atlas stored with it.
      </p>
    </div>
  )
}

/**
 * Where Roblox accepts a classic garment upload, per kind.
 *
 * Roblox does not let an app publish classic clothing, so this is a handoff, not
 * an upload: the panel saves the atlas and opens the right dashboard tab.
 */
const UPLOAD_GUIDE: Record<string, { label: string; url: string }> = {
  shirt: {
    label: 'Classic Shirts',
    url: 'https://create.roblox.com/dashboard/creations?activeTab=Shirt'
  },
  pants: {
    label: 'Classic Pants',
    url: 'https://create.roblox.com/dashboard/creations?activeTab=Pants'
  },
  tshirt: {
    label: 'T-Shirts',
    url: 'https://create.roblox.com/dashboard/creations?activeTab=TShirt'
  }
}

/**
 * Where a 3D model is published.
 *
 * A model *can* be uploaded by an app — unlike classic clothing — but that needs
 * an Open Cloud key the user has to supply, so the handoff below is the path
 * that works today: save the GLB, then import it in Studio. The dashboard tab is
 * where a user manages the resulting asset.
 */
const MODEL_GUIDE = {
  label: 'Creator Dashboard',
  url: 'https://create.roblox.com/dashboard/creations?activeTab=Model'
}

/** The file name RobloxKit uses: the slug, lowercased, capped. */
export function exportName(record: ArtifactRecord): string {
  const base = String(record.slug || 'clothing')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'clothing'
}

/**
 * What a model version's checks are.
 *
 * A model has no classic template, no layers and no painted regions, so the
 * garment checks would report a 585x559 template and zero layers for something
 * that is not a garment at all. What it does have is a file, a size, a triangle
 * count and a pass/fail — and those come from the same `report` the host wrote.
 */
function ModelChecks({ version }: { version: RecordVersion }): React.JSX.Element {
  const report = version.report as
    | {
        ok?: boolean
        triangles?: number
        size?: number[]
        issues?: { level: string; message: string }[]
      }
    | undefined
  const issues = report?.issues ?? []
  const errors = issues.filter((issue) => issue.level === 'error')
  const ok = report?.ok ?? version.ok ?? true
  const size = report?.size

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] text-muted-foreground">A 3D model, not a garment</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-semibold',
            ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
          )}
        >
          {ok ? 'Ready' : 'Failed'}
        </span>
      </div>
      <dl className="m-0">
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>File</dt>
          <dd className={VALUE_CLASS}>{version.model ?? version.atlas}</dd>
        </div>
        {typeof report?.triangles === 'number' && (
          <div className={ROW_CLASS}>
            <dt className={KEY_CLASS}>Triangles</dt>
            <dd className={VALUE_CLASS}>{report.triangles.toLocaleString()}</dd>
          </div>
        )}
        {Array.isArray(size) && size.length === 3 && (
          <div className={ROW_CLASS}>
            <dt className={KEY_CLASS}>Size</dt>
            <dd className={VALUE_CLASS}>
              {size.map((value) => value.toFixed(2)).join(' x ')} studs
            </dd>
          </div>
        )}
        <div className={ROW_CLASS}>
          <dt className={KEY_CLASS}>Issues</dt>
          <dd className={VALUE_CLASS}>
            {issues.length ? `${issues.length} (${errors.length} error)` : 'none'}
          </dd>
        </div>
      </dl>
      {issues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-3xs leading-relaxed">
          {issues.slice(0, 6).map((issue, index) => (
            <li
              key={`${issue.level}-${index}`}
              className={issue.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The one place a user can paste an Open Cloud key.
 *
 * The upload refuses with "no key is saved" and points at the dashboard, but there
 * was nowhere in the app to put the key - so the feature was unusable from the UI
 * even once everything behind it worked. Collapsed by default: it is a one-time
 * step, not something to look at every time.
 *
 * The key is validated by Roblox through introspect on save, so a wrong paste is
 * refused here with the reason instead of failing later on an upload.
 */
function KeySetup({ onSaved }: { onSaved: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await robloxApi.saveOpenCloudKey(key.trim(), userId.trim() || undefined)
      if (!saved.success) {
        setError(saved.error)
        return
      }
      setKey('')
      setUserId('')
      setOpen(false)
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-3xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Add an Open Cloud key
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-border/60 p-2">
      <label className="text-3xs text-muted-foreground" htmlFor="opencloud-key">
        Open Cloud key (create.roblox.com → Credentials → API Keys, with asset:write)
      </label>
      <input
        id="opencloud-key"
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder="paste the key"
        className="h-7 rounded border border-border/60 bg-card px-2 font-mono text-2xs"
      />
      <label className="text-3xs text-muted-foreground" htmlFor="opencloud-user">
        Your numeric Roblox user id
      </label>
      <input
        id="opencloud-user"
        type="text"
        inputMode="numeric"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
        placeholder="e.g. 834159885"
        className="h-7 rounded border border-border/60 bg-card px-2 font-mono text-2xs"
      />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={!key.trim() || busy}
          onClick={() => void save()}
          className="rounded border border-border px-2 py-1 text-3xs transition-colors hover:bg-secondary disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Save key'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-3xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-3xs leading-relaxed text-destructive">{error}</p>}
    </div>
  )
}
function UseIt({
  record,
  studioId
}: {
  record: ArtifactRecord | null
  /** The open place's MCP handle, or `null` when no place is open. */
  studioId?: string | null
}): React.JSX.Element {
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'copy' | 'upload' | null>(null)
  const model = isModelRecord(record)
  const kind = record ? versionFacts(currentVersion(record)).type : 'shirt'
  const guide = model ? MODEL_GUIDE : (UPLOAD_GUIDE[kind] ?? UPLOAD_GUIDE.shirt!)

  const upload = async (): Promise<void> => {
    if (!record || busy) return
    setBusy('upload')
    setStatus(null)
    try {
      const ready = await uploadReadiness(record, studioId ?? null)
      if (!ready.ready) {
        setStatus({ tone: 'bad', text: ready.reason ?? 'This model cannot be uploaded yet.' })
        return
      }
      const outcome = await uploadModelRecord(record, studioId as string)
      setStatus(
        outcome.ok
          ? {
              tone: outcome.recovery ? 'bad' : 'ok',
              text: outcome.recovery ?? `Uploaded as asset ${outcome.assetId}.`
            }
          : { tone: 'bad', text: outcome.reason }
      )
    } catch (cause) {
      setStatus({ tone: 'bad', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!record || busy) return
    setBusy('save')
    setStatus(null)
    try {
      const saved = model ? await saveModel(record) : await savePng(record)
      setStatus({ tone: 'ok', text: `Saved ${saved}.` })
    } catch (cause) {
      setStatus({ tone: 'bad', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(null)
    }
  }

  const copyPath = async (): Promise<void> => {
    if (!record || busy) return
    setBusy('copy')
    setStatus(null)
    try {
      const path = recordPath(record)
      const copied = await clipboardApi.writeText(path)
      setStatus(
        copied.success
          ? { tone: 'ok', text: 'Copied the folder path.' }
          : { tone: 'bad', text: `Could not copy: ${copied.error}` }
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {model
          ? 'A model can be imported straight into Studio, or uploaded as a Roblox asset.'
          : 'Roblox does not let apps publish classic clothing: the upload is yours.'}
      </p>
      <button
        type="button"
        disabled={!record || busy !== null}
        onClick={() => void save()}
        className="rounded border border-border px-2 py-1 text-[10.5px] text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
      >
        {busy === 'save' ? 'Saving…' : model ? 'Save GLB to project' : 'Save PNG to project'}
      </button>
      <button
        type="button"
        disabled={!record || busy !== null}
        onClick={() => void copyPath()}
        title={record ? recordPath(record) : undefined}
        className="rounded border border-border px-2 py-1 text-[10.5px] text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
      >
        {busy === 'copy' ? 'Copying…' : 'Copy folder path'}
      </button>
      <button
        type="button"
        onClick={() => void openerApi.openUrlWithSystemBrowser(guide.url)}
        className="rounded border border-border px-2 py-1 text-[10.5px] text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Open {guide.label}
      </button>
      {model && (
        <button
          type="button"
          disabled={!record || busy !== null}
          onClick={() => void upload()}
          title={
            studioId
              ? 'Upload the GLB as a Roblox Model asset, then insert it into the open place'
              : 'Open a place in Roblox Studio first'
          }
          className="rounded border border-border px-2 py-1 text-[10.5px] text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          {busy === 'upload' ? 'Uploading…' : 'Upload to Roblox'}
        </button>
      )}
      {model && (
        <KeySetup
          onSaved={() => setStatus({ tone: 'ok', text: 'Key saved. Press Upload to Roblox.' })}
        />
      )}
      {model ? (
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-3xs leading-relaxed text-muted-foreground">
          <li>Save the GLB above.</li>
          <li>In Studio, open the 3D Importer and choose the file.</li>
          <li>Set its scale, then insert it into the place.</li>
        </ol>
      ) : (
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-3xs leading-relaxed text-muted-foreground">
          <li>Save the PNG above.</li>
          <li>Open the dashboard tab for this kind.</li>
          <li>Upload the file as a classic garment.</li>
          <li>Set it for sale, then wear it in Studio.</li>
        </ol>
      )}
      {status && (
        <p
          className={cn(
            'text-3xs leading-relaxed',
            status.tone === 'ok' ? 'text-success' : 'text-destructive'
          )}
        >
          {status.text}
        </p>
      )}
    </div>
  )
}

interface RobloxInspectorProps {
  record: ArtifactRecord | null
  version: RecordVersion | null
  paint: PaintReport | null
  onRestore?: (n: number) => Promise<void>
  /** Which tab is open, so a node in the pipeline can drive it. */
  tab?: TabId
  onTabChange?: (tab: TabId) => void
  /**
   * Which sections this engine has.
   *
   * Defaults to the clothing set, so an existing caller is unchanged. A 3D page
   * passes `MODEL_TABS`: a model has no regions and no layers, and those tabs
   * would read garment facts and render empty.
   */
  tabs?: readonly TabId[]
  /** What to say when there is nothing to inspect, per engine. */
  emptyHint?: string
  /**
   * The open place's MCP handle, for the model upload.
   *
   * Optional because clothing cannot be uploaded at all, and a garment page has
   * no reason to read Studio status. A model page passes it so `Use it` can offer
   * the upload and say why it is unavailable when no place is open.
   */
  studioId?: string | null
}

export function RobloxInspector({
  record,
  version,
  paint,
  onRestore,
  tab: controlledTab,
  onTabChange,
  tabs = CLOTHING_TABS,
  emptyHint = 'Pick a garment in the Roblox panel to inspect it.',
  studioId
}: RobloxInspectorProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const [ownTab, setOwnTab] = useState<TabId>('Checks')
  const tab = controlledTab ?? ownTab
  const selectTab = (next: TabId): void => {
    setOwnTab(next)
    onTabChange?.(next)
  }
  // A t-shirt is one full-bleed graphic, so a per-region breakdown says nothing
  // the engine itself does not skip (`check.ts` skips it for the same reason).
  const regionsApply =
    tabs.includes('Regions') && (!version || versionFacts(version).type !== 'tshirt')
  const visibleTabs: readonly TabId[] = regionsApply ? tabs : tabs.filter((id) => id !== 'Regions')
  const activeTab: TabId = visibleTabs.includes(tab) ? tab : 'Checks'

  if (!open) {
    return (
      <div className="flex h-full w-8 shrink-0 flex-col items-center border-l border-border/60 bg-card pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label="Show the inspector"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft size={13} />
        </button>
      </div>
    )
  }

  return (
    <aside
      aria-label="Inspector"
      className="flex h-full w-[236px] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-card"
    >
      <div className="flex items-center justify-between px-2 pt-2">
        <span className="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">
          Inspector
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded
          aria-label="Hide the inspector"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Inspector sections"
        className="flex flex-wrap gap-px px-2 pt-1"
      >
        {visibleTabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => selectTab(id)}
            className={cn(TAB_CLASS, activeTab === id && TAB_ON)}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-3">
        {!record || !version ? (
          <p className="text-[10.5px] text-muted-foreground">{emptyHint}</p>
        ) : (
          <>
            <p className="mb-0.5 text-xs font-semibold">{version.prompt?.trim() || record.slug}</p>
            <p className="mb-3 text-[10.5px] leading-snug text-muted-foreground">
              {record.kind} · v{version.n}
            </p>

            {activeTab === 'Checks' && <Checks version={version} paint={paint} />}
            {activeTab === 'Regions' && <Regions version={version} paint={paint} />}
            {activeTab === 'Layers' && <Layers version={version} />}
            {activeTab === 'Versions' && (
              <Versions record={record} current={version} onRestore={onRestore} />
            )}
            {activeTab === 'Use it' && <UseIt record={record} studioId={studioId} />}
          </>
        )}
      </div>
    </aside>
  )
}
