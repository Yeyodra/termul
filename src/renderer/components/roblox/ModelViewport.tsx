/**
 * The 3D model a record holds, in the viewport the page already has.
 *
 * One `ArtifactViewportPanel` per page, for the same reason `ClothingViewport`
 * uses one: `ArtifactViewport` is deliberately per-instance, because a shared
 * WebGL surface caused three separate bugs (commit `640ed56e`).
 *
 * The model is drawn from the spec the record stores, not from its GLB. A GLB
 * carries the palette as an embedded PNG that `GLTFLoader` decodes
 * asynchronously, and when that decode fails three.js silently keeps a white
 * base colour - which is why every model rendered colourless. Building the mesh
 * from the spec attaches the palette in the same synchronous step, so a model
 * cannot appear without its colours.
 */

import { useEffect, useMemo } from 'react'
import { useRobloxStudioStatus } from '@/hooks/use-roblox-studio-status'
import { type ArtifactRecord, currentVersion, restoreVersion } from '@/lib/artifact-records'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { SpecModelArtifact } from '@/lib/generator/viewport/artifact'
import { useProjectRecords, useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { pickSlug, usePickedSlug } from '@/stores/roblox-selection-store'
import { ModelComposer } from './ModelComposer'
import { MODEL_TABS, RobloxInspector } from './RobloxInspector'

interface ModelViewportProps {
  projectPath: string
}

export function ModelViewport({ projectPath }: ModelViewportProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)
  const refresh = useRobloxRecordsStore((state) => state.refresh)
  // The upload needs the open place's handle, and the same poll that feeds the
  // status-bar lamp already knows it.
  const studio = useRobloxStudioStatus({ enabled: true })

  useEffect(() => {
    load(projectPath)
  }, [load, projectPath])

  /**
   * The record on screen: the pick, else the newest that actually holds a model.
   *
   * Filtering on `version.model` rather than on `record.kind` is what keeps a
   * clothing record out of a 3D page: the two engines file under different
   * sub-folders, but the reliable discriminator is whether the version wrote a
   * model file at all.
   */
  const active = useMemo<ArtifactRecord | null>(() => {
    if (!records || records.length === 0) return null
    const withModel = records.filter((record) => Boolean(currentVersion(record).model))
    if (!withModel.length) return null
    if (!picked) return withModel[0] ?? null
    return withModel.find((record) => record.slug === picked) ?? null
  }, [records, picked])

  const version = active ? currentVersion(active) : null

  const artifact = useMemo<SpecModelArtifact | null>(() => {
    if (!version?.design) return null
    return {
      kind: 'model',
      spec: version.design,
      name: version.prompt?.trim() || active?.slug
    }
  }, [version, active])

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

  const placeholder = active
    ? `Reading v${version?.n ?? 1}.`
    : records?.length
      ? 'Describe a model below and it lands here.'
      : 'Describe a model below, or ask the agent for one.'

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ArtifactViewportPanel
            artifact={artifact}
            placeholder={placeholder}
            className="min-h-0 flex-1"
          />
        </div>
        {active && version ? (
          <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-2xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Name</dt>
              <dd className="truncate">{active.slug}</dd>
            </div>
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
              <dt>File</dt>
              <dd className="truncate font-mono">{version.model ?? version.atlas}</dd>
            </div>
          </dl>
        ) : null}
        <ModelComposer
          projectPath={projectPath}
          record={active}
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
        paint={null}
        onRestore={handleRestore}
        tabs={MODEL_TABS}
        emptyHint="Generate a model, then pick it in the Roblox panel to inspect it."
        studioId={studio?.studioId ?? null}
      />
    </div>
  )
}
