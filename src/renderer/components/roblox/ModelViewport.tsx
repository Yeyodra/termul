/**
 * The 3D model a record holds, in the viewport the page already has.
 *
 * One `ArtifactViewportPanel` per page, for the same reason `ClothingViewport`
 * uses one: `ArtifactViewport` is deliberately per-instance, because a shared
 * WebGL surface caused three separate bugs (commit `640ed56e`).
 *
 * The model arrives from the records store as a `data:model/gltf-binary` URL,
 * which `MeshArtifact` already knows how to fetch and `GLTFLoader` parses. That
 * is why this component is a reader and not a builder: the generation path
 * writes the GLB, the store reads it, and the viewport draws it.
 */

import { useEffect, useMemo } from 'react'
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import { ArtifactViewportPanel } from '@/lib/generator/viewport/ArtifactViewportPanel'
import type { MeshArtifact } from '@/lib/generator/viewport/artifact'
import {
  useProjectRecords,
  useRecordModel,
  useRobloxRecordsStore
} from '@/stores/roblox-records-store'
import { usePickedSlug } from '@/stores/roblox-selection-store'

interface ModelViewportProps {
  projectPath: string
}

export function ModelViewport({ projectPath }: ModelViewportProps): React.JSX.Element {
  const records = useProjectRecords(projectPath)
  const picked = usePickedSlug(projectPath)
  const load = useRobloxRecordsStore((state) => state.load)

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

  const model = useRecordModel(projectPath, active)
  const version = active ? currentVersion(active) : null

  const artifact = useMemo<MeshArtifact | null>(() => {
    if (!model || !active) return null
    return {
      kind: 'mesh',
      format: 'glb',
      url: model,
      name: version?.prompt?.trim() || active.slug
    }
  }, [model, active, version])

  const placeholder = active
    ? `Reading v${version?.n ?? 1}.`
    : records?.length
      ? 'No 3D model in this project yet. Ask the agent to generate one.'
      : 'Describe a model in the chat and the agent will build it.'

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
    </div>
  )
}
