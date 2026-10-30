/**
 * The generated garments of a project, read once and shared.
 *
 * The collection list now lives in the Side panel and the viewport in the page
 * (D2 + D6), so two components need the same records. Loading per component
 * would read every `item.json` twice and every PNG twice — binary reads go
 * through the brokered attachment path, so that is not free.
 *
 * A record is keyed by `<project>|<slug>@<n>`: the atlas and still belong to a
 * version, not to an item, so restoring a pointer cannot hand the viewport a
 * picture of a different version (D9).
 */

import { create } from 'zustand'
import {
  type ArtifactRecord,
  currentVersion,
  loadArtifactRecords,
  readAtlasDataUrl,
  readModelDataUrl,
  readStillDataUrl
} from '@/lib/artifact-records'

/**
 * Exported because an outfit reads several records' atlases at once, and a hook
 * cannot be called in a loop: the page keys into `atlases` with this instead.
 */
export function pictureKey(projectPath: string, slug: string, n: number): string {
  return `${projectPath}|${slug}@${n}`
}

interface RobloxRecordsState {
  /** Project path -> records, newest first. Absent while nothing was loaded. */
  recordsByProject: Record<string, ArtifactRecord[]>
  /** Project path -> true once a load finished (even when it found nothing). */
  loaded: Record<string, boolean>
  /** `<project>|<slug>@<n>` -> atlas data URL. */
  atlases: Record<string, string>
  /** `<project>|<slug>@<n>` -> review-sheet data URL. */
  stills: Record<string, string>
  /**
   * `<project>|<slug>@<n>` -> model data URL, for a 3D record.
   *
   * Kept apart from `atlases` because the media type differs: a GLB arrives as
   * `model/gltf-binary` and must not be handed to an image decoder. Only a
   * version that actually has a model file lands here, so a clothing record
   * leaves this empty and nothing downstream has to branch on kind.
   */
  models: Record<string, string>
  /** Project paths with a read in flight, so a re-render cannot start a second. */
  reading: Record<string, boolean>
  load: (projectPath: string) => Promise<void>
  /** Re-read, resolving once the new list is in the store. */
  refresh: (projectPath: string) => Promise<void>
}

export const useRobloxRecordsStore = create<RobloxRecordsState>((set, get) => {
  /** Read every picture a record still needs, then store what came back. */
  const readPictures = async (projectPath: string, records: ArtifactRecord[]): Promise<void> => {
    const { atlases, stills, models } = get()
    const wanted = records.map((record) => {
      const version = currentVersion(record)
      return { record, version, key: pictureKey(projectPath, record.slug, version.n) }
    })

    const results = await Promise.all(
      wanted.map(async ({ record, version, key }) => {
        const isModel = Boolean(version.model)
        const model = isModel
          ? (models[key] ?? (await readModelDataUrl(record, version)) ?? undefined)
          : undefined
        const atlas = isModel
          ? undefined
          : (atlases[key] ?? (await readAtlasDataUrl(record, version)) ?? undefined)
        const still = stills[key] ?? (await readStillDataUrl(record, version)) ?? undefined
        return { key, atlas, still, model }
      })
    )

    set((state) => {
      const nextAtlases = { ...state.atlases }
      const nextStills = { ...state.stills }
      const nextModels = { ...state.models }
      for (const { key, atlas, still, model } of results) {
        if (atlas) nextAtlases[key] = atlas
        if (still) nextStills[key] = still
        if (model) nextModels[key] = model
      }
      return { atlases: nextAtlases, stills: nextStills, models: nextModels }
    })
  }

  /**
   * One read per project at a time, and a caller that arrives mid-read waits for
   * that read instead of returning at once.
   *
   * Returning immediately made `refresh` resolve before the new list was in the
   * store, so a caller that then picked the slug it had just written picked a
   * record the list did not have yet and the page fell back to a different one.
   */
  const inflight: Record<string, Promise<void>> = {}

  const read = async (projectPath: string, force: boolean): Promise<void> => {
    const running = inflight[projectPath]
    if (running) {
      await running
      if (!force) return
    } else {
      const state = get()
      if (!force && state.loaded[projectPath]) return
    }

    const task = (async (): Promise<void> => {
      set((current) => ({ reading: { ...current.reading, [projectPath]: true } }))
      try {
        const records = await loadArtifactRecords(projectPath)
        set((current) => ({
          recordsByProject: { ...current.recordsByProject, [projectPath]: records },
          loaded: { ...current.loaded, [projectPath]: true }
        }))
        await readPictures(projectPath, records)
      } finally {
        set((current) => {
          const reading = { ...current.reading }
          delete reading[projectPath]
          return { reading }
        })
      }
    })()

    inflight[projectPath] = task
    try {
      await task
    } finally {
      delete inflight[projectPath]
    }
  }

  return {
    recordsByProject: {},
    loaded: {},
    atlases: {},
    stills: {},
    models: {},
    reading: {},
    load: (projectPath) => {
      if (!projectPath) return Promise.resolve()
      return read(projectPath, false)
    },
    refresh: (projectPath) => {
      if (!projectPath) return Promise.resolve()
      return read(projectPath, true)
    }
  }
})

/** The atlas of a record's current version, once it is read. */
export function useRecordAtlas(projectPath: string | undefined, record: ArtifactRecord | null) {
  return useRobloxRecordsStore((state) => {
    if (!projectPath || !record) return undefined
    return state.atlases[pictureKey(projectPath, record.slug, currentVersion(record).n)]
  })
}

/** The review sheet of a record's current version, once it is read. */
export function useRecordStill(
  projectPath: string | undefined,
  record: ArtifactRecord | null
): string | undefined {
  return useRobloxRecordsStore((state) => {
    if (!projectPath || !record) return undefined
    return state.stills[pictureKey(projectPath, record.slug, currentVersion(record).n)]
  })
}

export function useProjectRecords(projectPath: string | undefined): ArtifactRecord[] | undefined {
  return useRobloxRecordsStore((state) =>
    projectPath ? state.recordsByProject[projectPath] : undefined
  )
}

/** The model of a record's current version, once it is read. */
export function useRecordModel(
  projectPath: string | undefined,
  record: ArtifactRecord | null
): string | undefined {
  return useRobloxRecordsStore((state) => {
    if (!projectPath || !record) return undefined
    return state.models[pictureKey(projectPath, record.slug, currentVersion(record).n)]
  })
}

/**
 * Re-read every project this window already loaded.
 *
 * A generation finishes in this window but is written to disk by the host, so
 * nothing here knows which project the new record landed in. The loaded set is
 * the answer: a project is only in it because a Roblox surface already read it,
 * so a refresh there is both bounded and useful.
 */
export function refreshLoadedProjects(): void {
  const state = useRobloxRecordsStore.getState()
  for (const projectPath of Object.keys(state.loaded)) {
    state.refresh(projectPath)
  }
}
