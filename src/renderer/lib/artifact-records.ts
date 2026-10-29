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

/**
 * Join a project root with a relative path, keeping one separator style.
 *
 * A project path from the host is a Windows path: backslashes, and often a
 * `\\?\` verbatim prefix. Appending `/`-separated segments to that produces
 * `C:\dir/.termul/generated`, which Windows tolerates but the fs plugin does not
 * always resolve. Normalising the root to forward slashes first keeps the whole
 * path in one style, which is what the rest of the renderer already uses.
 */
function joinPath(...parts: string[]): string {
  const [root, ...rest] = parts
  const head = (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  const tail = rest
    .map((part) => part.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
  return [head, ...tail].join('/')
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

/**
 * The garment kind a record holds.
 *
 * The host files a record under the *generator* (`clothing`), which is the folder
 * name, and writes no `kind` of its own. The garment type lives in each version's
 * `design.type` (`shirt` / `pants` / `tshirt`), which is what a row should show.
 * Reading the folder name instead printed "clothing" on every row.
 */
function kindOf(fields: Record<string, unknown>, versions: RecordVersion[]): string {
  const declared = typeof fields.kind === 'string' ? fields.kind : undefined
  const fromDesign = versions
    .map((version) => (version.design as { type?: unknown } | undefined)?.type)
    .find((type): type is string => typeof type === 'string')
  if (fromDesign) return fromDesign
  return declared ?? 'clothing'
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
    kind: kindOf(fields, versions),
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

export type RestoreOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'missing-version' | 'no-atlas' | 'conflict' | 'write-failed'
      message: string
    }

/**
 * Move a record's `current` pointer to another version and write it back.
 *
 * Deliberately not a re-render: the viewport reads `atlas` from the version the
 * pointer names, so moving the pointer is the whole operation. RobloxKit can
 * rebuild a thumbnail from `design` here; Termul cannot, because the design in
 * `item.json` is unvalidated `unknown` and no renderer accepts it.
 *
 * A version whose atlas is gone is refused rather than accepted: restoring to it
 * would leave the viewport with nothing to draw, which reads as a bug rather
 * than as the missing file it is.
 *
 * The write carries the file's sha256 as a precondition, so a generation that
 * lands between the read and the write fails the write instead of silently
 * dropping the version it just appended.
 */
export async function restoreVersion(record: ArtifactRecord, n: number): Promise<RestoreOutcome> {
  const target = record.versions.find((version) => version.n === n)
  if (!target) {
    return {
      ok: false,
      reason: 'missing-version',
      message: `v${n} is not in this record`
    }
  }

  const atlas = await readAttachmentBytes(joinPath(record.dir, target.atlas)).catch(() => null)
  if (!atlas) {
    return {
      ok: false,
      reason: 'no-atlas',
      message: `v${n} has no atlas file, so it cannot be shown`
    }
  }

  const file = await filesystemApi.readFile(record.itemPath)
  if (!file.success || !file.data) {
    return { ok: false, reason: 'write-failed', message: 'could not read item.json' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(file.data.content)
  } catch {
    return { ok: false, reason: 'write-failed', message: 'item.json is not valid JSON' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'write-failed', message: 'item.json is not an object' }
  }

  const next = {
    ...(raw as Record<string, unknown>),
    current: n,
    updatedAt: Date.now()
  }

  const written = await filesystemApi.writeFile(
    record.itemPath,
    JSON.stringify(next),
    file.data.contentHash ? { expected: { sha256: file.data.contentHash } } : undefined
  )
  if (!written.success) {
    return {
      ok: false,
      reason: written.code === 'PRECONDITION_FAILED' ? 'conflict' : 'write-failed',
      message: written.error ?? 'could not write item.json'
    }
  }
  return { ok: true }
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

/**
 * Copy a version's atlas to `<project>/<slug>.png`, which is the file a user
 * hands to Roblox.
 *
 * The atlas is already on disk inside the record, so this is a copy, not a
 * re-render: Roblox wants the flat 585x559 sheet, and that is exactly what
 * `v<n>.png` holds. Copying it to the project root keeps it findable, which is
 * what RobloxKit's `saveClothingPng` does with the same intent.
 *
 * The write goes through `copyFile`, not `writeFile`: the latter takes text, so
 * handing it base64 would produce a PNG of the base64 string.
 *
 * Returns the absolute path written.
 */
export async function savePng(record: ArtifactRecord): Promise<string> {
  const version = currentVersion(record)
  const source = joinPath(record.dir, version.atlas)

  const marker = record.dir.lastIndexOf('/.termul/')
  const root = marker > 0 ? record.dir.slice(0, marker) : record.dir
  const name = String(record.slug || 'clothing')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const target = joinPath(root, `${name || 'clothing'}.png`)

  const written = await filesystemApi.copyFile(source, target)
  if (!written.success) {
    throw new Error(written.error ?? 'could not write the PNG')
  }
  return target
}
