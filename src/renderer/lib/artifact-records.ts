/**
 * Reading generated garment records back from disk.
 *
 * A generation writes `<project>/.termul/generated/<kind>/<slug>/item.json` plus
 * one PNG per version (see `parent/generator.rs`). This module turns those into
 * what a page needs, so a relaunch rebuilds the collection instead of losing it.
 *
 * The walk is two levels deep and bounded. `readDirectory` is single-level, so
 * `<kind>` then `<slug>` is two calls per record — explicit and cheap — rather
 * than a recursive scan of a project that may be large.
 *
 * `readFile` refuses binaries with `BINARY_FILE`, so the PNGs go through
 * `readAttachmentBytes`, which is the only brokered binary-read path.
 */

import { readAttachmentBytes } from '@/lib/attachment-api'
import { filesystemApi } from '@/lib/filesystem-api'

const GENERATED_DIR = '.termul/generated'
const DEFAULT_LIMIT = 20

export interface RecordVersion {
  n: number
  at: number
  prompt?: string
  ok?: boolean
  design?: unknown
  /** Atlas file name inside the record directory, e.g. `v2.png`. */
  atlas: string
  /** Review-sheet file name inside the record directory, e.g. `v2.still.png`. */
  still?: string
}

export interface ArtifactRecord {
  slug: string
  kind: string
  current: number
  createdAt: number
  updatedAt: number
  versions: RecordVersion[]
  /** Absolute path of the record directory. */
  dir: string
  itemPath: string
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/')
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseVersion(raw: unknown): RecordVersion | null {
  if (!raw || typeof raw !== 'object') return null
  const fields = raw as Record<string, unknown>
  const n = asNumber(fields.n)
  const atlas = typeof fields.atlas === 'string' ? fields.atlas : undefined
  if (n === undefined || !atlas) return null
  return {
    n,
    at: asNumber(fields.at) ?? 0,
    prompt: typeof fields.prompt === 'string' ? fields.prompt : undefined,
    ok: typeof fields.ok === 'boolean' ? fields.ok : undefined,
    design: fields.design,
    atlas,
    still: typeof fields.still === 'string' ? fields.still : undefined
  }
}

/** Parse one `item.json`. Returns `null` for a record this build cannot read. */
export function parseRecord(text: string, dir: string): ArtifactRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const fields = raw as Record<string, unknown>
  const versions = Array.isArray(fields.versions)
    ? fields.versions
        .map(parseVersion)
        .filter((version): version is RecordVersion => version !== null)
    : []
  if (versions.length === 0) return null
  const slug = typeof fields.slug === 'string' ? fields.slug : (dir.split('/').pop() ?? '')
  if (!slug) return null
  const current = asNumber(fields.current) ?? versions[versions.length - 1]!.n
  return {
    slug,
    kind: typeof fields.kind === 'string' ? fields.kind : 'clothing',
    current,
    createdAt: asNumber(fields.createdAt) ?? 0,
    updatedAt: asNumber(fields.updatedAt) ?? 0,
    versions,
    dir,
    itemPath: joinPath(dir, 'item.json')
  }
}

/** The version a record is currently pointing at. */
export function currentVersion(record: ArtifactRecord): RecordVersion {
  return (
    record.versions.find((version) => version.n === record.current) ??
    record.versions[record.versions.length - 1]!
  )
}

async function readRecord(
  root: string,
  kind: string,
  slug: string
): Promise<ArtifactRecord | null> {
  const dir = joinPath(root, GENERATED_DIR, kind, slug)
  const file = await filesystemApi.readFile(joinPath(dir, 'item.json'))
  if (!file.success || !file.data) return null
  return parseRecord(file.data.content, dir)
}

/**
 * The project's records, most recently updated first. A record directory that
 * cannot be read is skipped rather than failing the whole collection: one
 * corrupt garment must not hide the others.
 */
export async function loadArtifactRecords(
  projectPath: string,
  limit = DEFAULT_LIMIT
): Promise<ArtifactRecord[]> {
  const generated = joinPath(projectPath, GENERATED_DIR)
  const kinds = await filesystemApi.readDirectory(generated)
  if (!kinds.success || !kinds.data) return []

  const slugs = await Promise.all(
    kinds.data
      .filter((entry) => entry.type === 'directory')
      .map(async (kind) => {
        const dir = joinPath(generated, kind.name)
        const children = await filesystemApi.readDirectory(dir)
        return children.success && children.data
          ? children.data
              .filter((child) => child.type === 'directory')
              .map((child) => ({ kind: kind.name, slug: child.name }))
          : []
      })
  )

  const records = await Promise.all(
    slugs.flat().map(({ kind, slug }) => readRecord(projectPath, kind, slug))
  )

  return records
    .filter((record): record is ArtifactRecord => record !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

function toDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * The version's atlas as a data URL, or `null` when the file is gone. The atlas
 * is what the viewport renders, so a missing one means this version cannot be
 * shown at all.
 */
export async function readAtlasDataUrl(
  record: ArtifactRecord,
  version: RecordVersion
): Promise<string | null> {
  try {
    return toDataUrl(await readAttachmentBytes(joinPath(record.dir, version.atlas)))
  } catch {
    return null
  }
}

/** The version's review sheet as a data URL, for a collapsed card. */
export async function readStillDataUrl(
  record: ArtifactRecord,
  version: RecordVersion
): Promise<string | null> {
  if (!version.still) return null
  try {
    return toDataUrl(await readAttachmentBytes(joinPath(record.dir, version.still)))
  } catch {
    return null
  }
}
