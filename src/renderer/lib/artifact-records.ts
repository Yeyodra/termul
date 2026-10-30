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
  /**
   * Model file name inside the record directory, e.g. `v1.glb`.
   *
   * A 3D version stores its GLB rather than re-building it from `design`, for
   * the same reason a clothing version stores its atlas: the viewport reads the
   * file, so storing only the spec would make a version unviewable until it was
   * rebuilt. For a 3D version `atlas` points at the GLB too, so older readers
   * that only know `atlas` still find something to show.
   */
  model?: string
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
  const model = typeof fields.model === 'string' ? fields.model : undefined
  // A 3D version has no atlas PNG; its `atlas` field holds the GLB name, so a
  // version with `model` is valid even when `atlas` is absent.
  const atlas = typeof fields.atlas === 'string' ? fields.atlas : model
  if (n === undefined || !atlas) return null
  return {
    n,
    at: asNumber(fields.at) ?? 0,
    prompt: typeof fields.prompt === 'string' ? fields.prompt : undefined,
    ok: typeof fields.ok === 'boolean' ? fields.ok : undefined,
    design: fields.design,
    atlas,
    still: typeof fields.still === 'string' ? fields.still : undefined,
    model
  }
}

/**
 * The garment kind a record holds.
 *
 * The host files a record under the *generator* (`clothing`), which is the folder
 * name, and writes no `kind` of its own. The garment type lives in each version's
 * `design.type` (`shirt` / `pants` / `tshirt`), which is what a row should show.
 *
 * The CURRENT version decides, not the first one that has a type. A record whose
 * versions disagree - which an earlier bug could produce by revising with the
 * picker's kind instead of the record's - would otherwise report the kind of its
 * oldest version, and a revision would then be written into the wrong template
 * folder. The folder name is the last fallback, since it names the generator, not
 * the garment.
 */
function kindOf(fields: Record<string, unknown>, versions: RecordVersion[]): string {
  const typeOf = (version: RecordVersion | undefined): string | undefined => {
    const type = (version?.design as { type?: unknown } | undefined)?.type
    return typeof type === 'string' ? type : undefined
  }

  const declared = typeof fields.current === 'number' ? fields.current : undefined
  const current =
    declared !== undefined ? versions.find((version) => version.n === declared) : undefined
  const fromCurrent = typeOf(current)
  if (fromCurrent) return fromCurrent

  const fromAny = versions.map(typeOf).find((type): type is string => type !== undefined)
  if (fromAny) return fromAny

  return typeof fields.kind === 'string' ? fields.kind : 'clothing'
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

function toDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
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
 * The version's model as a `data:` URL, or `null` when the file is gone.
 *
 * A GLB goes in as `model/gltf-binary`, which is what the viewport's
 * `MeshArtifact` fetches; the other formats keep their own media type so the
 * same helper serves an OBJ or an STL export too.
 */
export async function readModelDataUrl(
  record: ArtifactRecord,
  version: RecordVersion
): Promise<string | null> {
  const file = version.model ?? version.atlas
  if (!file) return null
  try {
    return toDataUrl(await readAttachmentBytes(joinPath(record.dir, file)), modelMimeType(file))
  } catch {
    return null
  }
}

/** The media type a model file needs in its `data:` URL. */
export function modelMimeType(file: string): string {
  const extension = file.toLowerCase().split('.').pop() ?? ''
  if (extension === 'glb') return 'model/gltf-binary'
  if (extension === 'gltf') return 'model/gltf+json'
  if (extension === 'obj') return 'text/plain'
  if (extension === 'stl') return 'model/stl'
  return 'application/octet-stream'
}

/** The mesh format a model file name implies, for `MeshArtifact.format`. */
export function modelFormat(file: string): 'glb' | 'obj' | 'stl' {
  const extension = file.toLowerCase().split('.').pop() ?? ''
  if (extension === 'glb' || extension === 'gltf') return 'glb'
  if (extension === 'stl') return 'stl'
  return 'obj'
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
 * Returns the path RELATIVE to the project, because that is what the user should
 * read: an absolute path here printed this machine's home directory, which is
 * wrong the moment the project moves or another person opens it.
 */
export async function savePng(record: ArtifactRecord): Promise<string> {
  return copyArtifactToProject(record, currentVersion(record).atlas, 'png')
}

/**
 * Copy a version's model to `<project>/<slug>.<ext>`, which is the file a user
 * hands to Studio's 3D Importer or to Roblox.
 *
 * Same reasoning as `savePng`: the model is already on disk inside the record,
 * so this is a copy, not a re-export. The extension follows the version's own
 * file name, so a GLB stays a GLB and an OBJ stays an OBJ.
 */
export async function saveModel(record: ArtifactRecord): Promise<string> {
  const version = currentVersion(record)
  const file = version.model ?? version.atlas
  return copyArtifactToProject(record, file, modelFormat(file))
}

/** Shared body of the two save helpers: one copy into the project root. */
async function copyArtifactToProject(
  record: ArtifactRecord,
  file: string,
  extension: string
): Promise<string> {
  const source = joinPath(record.dir, file)

  const marker = record.dir.lastIndexOf('/.termul/')
  const root = marker > 0 ? record.dir.slice(0, marker) : record.dir
  const name = String(record.slug || 'clothing')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const relative = `${name || 'clothing'}.${extension}`
  const target = joinPath(root, relative)

  const written = await filesystemApi.copyFile(source, target)
  if (!written.success) {
    throw new Error(written.error ?? `could not write the ${extension.toUpperCase()}`)
  }
  return relative
}
