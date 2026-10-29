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
  readStillDataUrl
} from '@/lib/artifact-records'

function pictureKey(projectPath: string, slug: string, n: number): string {
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
  /** Project paths with a read in flight, so a re-render cannot start a second. */
  reading: Record<string, boolean>
  load: (projectPath: string) => void
  refresh: (projectPath: string) => void
}

export const useRobloxRecordsStore = create<RobloxRecordsState>((set, get) => {
  /** Read every picture a record still needs, then store what came back. */
  const readPictures = async (projectPath: string, records: ArtifactRecord[]): Promise<void> => {
    const { atlases, stills } = get()
    const wanted = records.map((record) => {
      const version = currentVersion(record)
      return { record, version, key: pictureKey(projectPath, record.slug, version.n) }
    })

    const results = await Promise.all(
      wanted.map(async ({ record, version, key }) => {
        const atlas = atlases[key] ?? (await readAtlasDataUrl(record, version)) ?? undefined
        const still = stills[key] ?? (await readStillDataUrl(record, version)) ?? undefined
        return { key, atlas, still }
      })
    )

    set((state) => {
      const nextAtlases = { ...state.atlases }
      const nextStills = { ...state.stills }
      for (const { key, atlas, still } of results) {
        if (atlas) nextAtlases[key] = atlas
        if (still) nextStills[key] = still
      }
      return { atlases: nextAtlases, stills: nextStills }
    })
  }

  const read = async (projectPath: string, force: boolean): Promise<void> => {
    const state = get()
    if (state.reading[projectPath]) return
    if (!force && state.loaded[projectPath]) return

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
  }

  return {
    recordsByProject: {},
    loaded: {},
    atlases: {},
    stills: {},
    reading: {},
    load: (projectPath) => {
      if (!projectPath) return
      void read(projectPath, false)
    },
    refresh: (projectPath) => {
      if (!projectPath) return
      void read(projectPath, true)
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
