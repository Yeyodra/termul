/**
 * Uploading a stored model to Roblox, from the page.
 *
 * The pieces all exist by now: `buildSpec` rebuilds a `Model` from a record's
 * spec, `toGlb` writes the bytes, `partsForStudio` and `rigForStudio` describe
 * the parts, `insertLuau` emits the script, and the host owns the key. This
 * module is the one place they meet, so the button in `Use it` stays a button.
 *
 * The model is rebuilt from the spec rather than read back from the `.glb` on
 * disk, and that is deliberate: the spec is what the record now stores (a 3D
 * version keeps `design`, which `version_fields` fills from the engine's `spec`),
 * so a rebuild is the same deterministic output the generation produced. Reading
 * the file would work too, but it would make the export path untested by the
 * button that uses it.
 *
 * An upload that cannot start says which thing is missing — no key, no creator,
 * no place, no spec — because each has a different fix.
 */
import { type ArtifactRecord, currentVersion } from '@/lib/artifact-records'
import { buildSpec, type Model } from '@/lib/generator/engines/3d/build'
import { toGlb } from '@/lib/generator/engines/3d/export'
import type { ModelSpec } from '@/lib/generator/engines/3d/schema'
import {
  describeSend,
  insertLuau,
  PLACEHOLDER_ASSET_ID,
  partsForStudio,
  rigForStudio
} from '@/lib/generator/engines/3d/studio'
import { robloxApi } from '@/lib/tauri-roblox'

/** Why an upload could not start, or what it produced. */
export type UploadOutcome =
  | { ok: true; assetId: number; message: string; recovery: string | null }
  | { ok: false; reason: string; code: string }

/** What the button needs to know before it offers itself. */
export interface UploadReadiness {
  ready: boolean
  /** Why not, when `ready` is false. */
  reason: string | null
}

/**
 * Whether a record can be uploaded, without uploading anything.
 *
 * Checked in the order the failures cost: a missing spec means there is nothing
 * to send, a missing key or creator means Roblox would refuse, and a missing
 * place means the upload would succeed but the insert could not run.
 */
export async function uploadReadiness(
  record: ArtifactRecord | null,
  studioId: string | null
): Promise<UploadReadiness> {
  if (!record) return { ready: false, reason: 'Pick a model first.' }

  const version = currentVersion(record)
  if (!version.model) {
    return { ready: false, reason: 'This version has no model file.' }
  }
  if (!version.design) {
    return {
      ready: false,
      reason:
        'This version was saved before its spec was kept, so it cannot be rebuilt. Generate it again.'
    }
  }

  const status = await robloxApi.openCloudStatus()
  if (!status.success) {
    return { ready: false, reason: status.error }
  }
  if (!status.data.configured) {
    return {
      ready: false,
      reason:
        status.data.reason ??
        'No Open Cloud API key is saved. Add one from create.roblox.com → Credentials with the Assets permission and asset:write.'
    }
  }
  if (!status.data.userId) {
    return { ready: false, reason: 'No Roblox user id is saved with the key.' }
  }
  if (!studioId) {
    return { ready: false, reason: 'Open a place in Roblox Studio first.' }
  }

  return { ready: true, reason: null }
}

/** A base64 string with no line breaks, which is what the host decodes. */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/**
 * Rebuild, export, upload, and insert.
 *
 * The insert script is built here rather than in Rust because this is where the
 * protocol strings live; it carries [`PLACEHOLDER_ASSET_ID`] because the real id
 * does not exist until the upload returns, and the host substitutes it.
 */
export async function uploadModelRecord(
  record: ArtifactRecord,
  studioId: string
): Promise<UploadOutcome> {
  const version = currentVersion(record)
  const spec = version.design as ModelSpec | null
  if (!spec) {
    return {
      ok: false,
      code: 'NO_SPEC',
      reason: 'This version carries no spec, so the model cannot be rebuilt.'
    }
  }

  let model: Model
  try {
    model = buildSpec(spec)
  } catch (cause) {
    return {
      ok: false,
      code: 'BUILD_FAILED',
      reason: `The stored spec no longer builds: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }

  const category = spec.category
  const planned = describeSend(model, {
    category,
    accessoryType: spec.accessoryType
  })

  const glb = toGlb(model, { name: record.slug, merge: planned.merge })
  const rig = rigForStudio(model)
  const luau = insertLuau({
    assetId: PLACEHOLDER_ASSET_ID,
    name: record.slug,
    rig,
    category,
    kind: spec.accessoryType,
    attachment: planned.attachment,
    parts: partsForStudio(model, { merge: planned.merge }),
    merge: planned.merge
  })

  const uploaded = await robloxApi.uploadModel({
    glbBase64: base64Of(glb),
    name: record.slug,
    description: version.prompt?.trim() || record.slug,
    studioId,
    luau
  })

  if (!uploaded.success) {
    return { ok: false, code: uploaded.code, reason: uploaded.error }
  }

  return {
    ok: true,
    assetId: uploaded.data.assetId,
    message: uploaded.data.message,
    recovery: uploaded.data.recovery
  }
}
