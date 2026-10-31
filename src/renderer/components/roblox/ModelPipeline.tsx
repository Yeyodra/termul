/**
 * The three nodes above the 3D viewport, as in RobloxKit's `3d` page.
 *
 * RobloxKit's model page carries a labelled pipeline - `3d/kind`, `3d/rig` or
 * `3d/shape`, `3d/model` - where each card reports one fact about the model on
 * screen (`GeneratorPanel-BNGBBwll.js:875`). The clothing page here already had
 * that shape in `NodePipeline`; the 3D page had nothing above the viewport, so a
 * model showed a slug and no facts at all.
 *
 * Every value is read from the record and its checks, never from a timer. The dot
 * is the stage: grey when nothing ran, orange while it runs, green when the
 * version passes, red when it does not.
 */

import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { type ModelReport, modelFacts } from '@/lib/roblox-inspector'
import { cn } from '@/lib/utils'
import type { StageSnapshot } from '@/stores/roblox-stage-store'
import type { TabId } from './RobloxInspector'

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

interface ModelPipelineProps {
  record: ArtifactRecord | null
  version: RecordVersion | null
  stage: StageSnapshot
  onOpenTab: (tab: TabId) => void
}

export function ModelPipeline({
  record,
  version,
  stage,
  onOpenTab
}: ModelPipelineProps): React.JSX.Element {
  const report = (version?.report ?? null) as ModelReport | null
  const facts = modelFacts(report, version?.design)
  const running = stage.state === 'running'
  const ok = version?.ok !== false
  // RobloxKit keeps these nodes mounted while a build runs and writes "Building…"
  // in the model node, so the pipeline is the progress readout rather than a
  // summary that appears only once there is something to summarise.
  const built = Boolean(report)
  const label = running ? (stage.detail ?? stage.stage ?? 'Building…') : null

  // A rigged model reports its skeleton; an unrigged one reports its shape. That
  // is the split RobloxKit makes between `3d/rig` and `3d/shape`.
  const rigged = facts.rigged

  return (
    <div className="grid shrink-0 grid-cols-3 items-stretch gap-1 px-3 pt-2">
      <button
        type="button"
        onClick={() => onOpenTab('Checks')}
        className={cn(NODE, 'hover:bg-muted/60')}
      >
        <span className={LABEL}>3d/kind</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, ok)} />
          {version?.kind || record?.kind || 'Model'}
        </span>
        <span className={KV}>
          <span>Parts</span>
          <span className="tabular-nums">{built ? facts.parts : '—'}</span>
        </span>
        <span className={KV}>
          <span>Version</span>
          <span className="tabular-nums">{version ? `v${version.n}` : '—'}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpenTab('Checks')}
        className={cn(NODE, 'hover:bg-muted/60', running && 'border-warning/60')}
      >
        <span className={LABEL}>{rigged ? '3d/rig' : '3d/shape'}</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, ok)} />
          {rigged ? facts.rig || 'Custom' : 'Unrigged'}
        </span>
        <span className={KV}>
          <span>{rigged ? 'Joints' : 'Colours'}</span>
          <span className="tabular-nums">{rigged ? facts.joints : facts.colours}</span>
        </span>
        <span className={KV}>
          <span>Size</span>
          <span className="tabular-nums">{facts.sizeLabel}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpenTab('Use it')}
        className={cn(NODE, 'hover:bg-muted/60')}
      >
        <span className={LABEL}>3d/model</span>
        <span className={cn(VALUE, 'flex items-center gap-1')}>
          <span aria-hidden="true" className={dotClass(stage.state, ok)} />
          {version?.prompt?.trim() || record?.slug || 'Nothing yet'}
        </span>
        {built ? (
          <>
            <span className={KV}>
              <span>Triangles</span>
              <span className="tabular-nums">{facts.trianglesLabel}</span>
            </span>
            <span className={KV}>
              <span>Status</span>
              <span
                className={cn(running ? 'text-warning' : ok ? 'text-success' : 'text-destructive')}
              >
                {running ? 'running' : ok ? 'ready' : 'failed'}
              </span>
            </span>
          </>
        ) : (
          // No report yet: say what the engine is doing instead of showing zeros
          // that read as a finished, empty model.
          <span className="truncate text-3xs text-muted-foreground">{label ?? 'Nothing yet'}</span>
        )}
      </button>
    </div>
  )
}
