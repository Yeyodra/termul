/**
 * The four nodes above the viewport, as in RobloxKit's `create/clothing` page.
 *
 * Each node reports one fact about the garment on screen, and its dot reports the
 * stage: grey when nothing ran, orange while it draws, green when the record is
 * ready, red when it failed. Clicking one opens the Inspector tab that explains
 * it, which is what the node pipeline is for in RobloxKit - navigation, not
 * decoration.
 *
 * Every value here is read from the record and the render, never from a timer.
 */

import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { SHEET_DIMENSIONS } from '@/lib/generator/engines/clothing/layout'
import { kindLabel } from '@/lib/roblox-features'
import { type PaintReport, versionFacts } from '@/lib/roblox-inspector'
import { cn } from '@/lib/utils'
import type { StageSnapshot } from '@/stores/roblox-stage-store'

export type InspectorTab = 'Checks' | 'Regions' | 'Layers' | 'Versions' | 'Use it'

const DOT = 'size-1.5 shrink-0 rounded-full'
const NODE =
  'flex min-w-0 flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2 py-1.5 text-left transition-colors'
const LABEL = 'truncate font-mono text-3xs text-muted-foreground'
const VALUE = 'truncate text-[11px] font-medium'
const KV = 'flex items-baseline justify-between gap-1 text-3xs text-muted-foreground'

function dotClass(state: StageSnapshot['state'], ok: boolean): string {
  if (state === 'running') return cn(DOT, 'bg-warning')
  if (state === 'error' || !ok) return cn(DOT, 'bg-destructive')
  if (state === 'done') return cn(DOT, 'bg-success')
  return cn(DOT, 'bg-muted-foreground/40')
}

function Arrow(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="shrink-0 self-center px-0.5 text-muted-foreground/40">
      →
    </span>
  )
}

interface NodePipelineProps {
  record: ArtifactRecord | null
  version: RecordVersion | null
  paint: PaintReport | null
  stage: StageSnapshot
  onOpenTab: (tab: InspectorTab) => void
}

export function NodePipeline({
  record,
  version,
  paint,
  stage,
  onOpenTab
}: NodePipelineProps): React.JSX.Element {
  const facts = version ? versionFacts(version) : null
  const size = facts ? facts.size : SHEET_DIMENSIONS.shirt
  const painted = paint ? `${paint.painted} / ${paint.total}` : '—'
  const running = stage.state === 'running'

  return (
    <div className="flex shrink-0 items-stretch gap-0 overflow-x-auto px-3 pt-2">
      <button
        type="button"
        onClick={() => onOpenTab('Checks')}
        className={cn(NODE, 'min-w-[112px] flex-1 hover:bg-muted/60')}
      >
        <span className={LABEL}>clothing/type</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, version?.ok !== false)} />
          {facts ? kindLabel(facts.type) : 'Shirt'}
        </span>
        <span className={KV}>
          <span>Size</span>
          <span className="tabular-nums">
            {size.width}x{size.height}
          </span>
        </span>
        <span className={KV}>
          <span>On</span>
          <span>R15 avatar</span>
        </span>
      </button>

      <Arrow />

      <button
        type="button"
        onClick={() => onOpenTab('Layers')}
        className={cn(NODE, 'min-w-[112px] flex-1 hover:bg-muted/60')}
      >
        <span className={LABEL}>clothing/pattern</span>
        <span className={cn(VALUE, 'font-normal')}>
          {version?.prompt?.trim() ? `"${version.prompt.trim()}"` : 'Nothing yet'}
        </span>
        <span className={KV}>
          <span>Layers</span>
          <span className="tabular-nums">{facts ? facts.layerCount : 0}</span>
        </span>
      </button>

      <Arrow />

      <button
        type="button"
        onClick={() => onOpenTab('Regions')}
        className={cn(
          NODE,
          'min-w-[112px] flex-1 hover:bg-muted/60',
          running && 'border-warning/60'
        )}
      >
        <span className={LABEL}>clothing/template</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, true)} />
          Regions
        </span>
        <span className={KV}>
          <span>Painted</span>
          <span className="tabular-nums">{painted}</span>
        </span>
      </button>

      <Arrow />

      <button
        type="button"
        onClick={() => onOpenTab('Use it')}
        className={cn(NODE, 'min-w-[112px] flex-1 hover:bg-muted/60')}
      >
        <span className={LABEL}>roblox/publish</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, version?.ok !== false)} />
          {version?.prompt?.trim() || record?.slug || 'Nothing yet'}
        </span>
        <span className={KV}>
          <span>Status</span>
          <span
            className={cn(
              running
                ? 'text-warning'
                : version?.ok === false
                  ? 'text-destructive'
                  : version
                    ? 'text-success'
                    : 'text-muted-foreground'
            )}
          >
            {running ? 'drawing' : version ? (version.ok === false ? 'failed' : 'ready') : 'idle'}
          </span>
        </span>
      </button>
    </div>
  )
}
