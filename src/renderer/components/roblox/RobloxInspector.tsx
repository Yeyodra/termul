/**
 * The Inspector: what the current garment version actually is.
 *
 * Five tabs over data the host already wrote, so nothing here waits on a
 * generation. "Painted" is the one live number: it needs the atlas pixels, so
 * the caller hands them in after decoding the PNG it already read for the
 * viewport.
 *
 * Collapsible (O4): at 1024px the viewport is the scarce resource, and folding
 * 236px of Inspector back into it matters more than the 6px that separated the
 * two collection layouts ever did.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { type PaintReport, versionFacts } from '@/lib/roblox-inspector'
import { cn } from '@/lib/utils'

const TABS = ['Checks', 'Regions', 'Layers', 'Versions', 'Use it'] as const
export type TabId = (typeof TABS)[number]

const TAB_CLASS =
  'inline-flex h-[22px] items-center rounded px-1.5 text-[10px] text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground'
const TAB_ON = 'bg-muted text-foreground'
const SECTION_CLASS = 'mb-1.5 text-3xs font-semibold tracking-wide text-muted-foreground uppercase'
const ROW_CLASS = 'flex items-baseline justify-between gap-2 py-[3px]'
const KEY_CLASS = 'text-[10.5px] text-muted-foreground'
const VALUE_CLASS = 'text-[10.5px] font-medium tabular-nums'

function Checks({ version, paint }: { version: RecordVersion; paint: PaintReport | null }) {
  const facts = useMemo(() => versionFacts(version), [version])

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

function UseIt() {
  return (
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">
      Exporting the PNG and opening Creator Dashboard is not wired yet. The atlas is on disk at the
      path shown on the page.
    </p>
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
}

export function RobloxInspector({
  record,
  version,
  paint,
  onRestore,
  tab: controlledTab,
  onTabChange
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
  const regionsApply = !version || versionFacts(version).type !== 'tshirt'
  const visibleTabs: readonly TabId[] = regionsApply ? TABS : TABS.filter((id) => id !== 'Regions')
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

      <div role="tablist" aria-label="Inspector" className="flex flex-wrap gap-px px-2 pt-1">
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
          <p className="text-[10.5px] text-muted-foreground">
            Pick a garment in the Roblox panel to inspect it.
          </p>
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
            {activeTab === 'Use it' && <UseIt />}
          </>
        )}
      </div>
    </aside>
  )
}
