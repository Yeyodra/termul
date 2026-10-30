import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauri-roblox', () => ({
  robloxApi: { openCloudStatus: vi.fn(), uploadModel: vi.fn() }
}))

import type { ArtifactRecord } from '@/lib/artifact-records'
import { R15_HERO_EXAMPLE } from '@/lib/generator/engines/3d/examples'
import { PLACEHOLDER_ASSET_ID } from '@/lib/generator/engines/3d/studio'
import { robloxApi } from '@/lib/tauri-roblox'
import { uploadModelRecord, uploadReadiness } from './roblox-upload'

const mockedStatus = vi.mocked(robloxApi.openCloudStatus)
const mockedUpload = vi.mocked(robloxApi.uploadModel)

const STUDIO_ID = 'studio-abc'

/** A record shaped like the host writes one for a generated model. */
function recordWith(overrides: Record<string, unknown> = {}): ArtifactRecord {
  return {
    slug: 'blocky-hero',
    kind: 'prop',
    current: 1,
    createdAt: 0,
    updatedAt: 0,
    dir: 'C:/p/.termul/generated/prop/blocky-hero',
    itemPath: 'C:/p/.termul/generated/prop/blocky-hero/item.json',
    versions: [
      {
        n: 1,
        at: 0,
        prompt: 'a blocky hero',
        design: R15_HERO_EXAMPLE,
        atlas: 'v1.glb',
        model: 'v1.glb',
        kind: 'character',
        ...overrides
      }
    ]
  }
}

const CONFIGURED = {
  success: true as const,
  data: { configured: true, reason: null, userId: '42' }
}

describe('uploadReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedStatus.mockResolvedValue(CONFIGURED)
  })

  it('refuses with no record, before asking the host anything', async () => {
    const ready = await uploadReadiness(null, STUDIO_ID)

    expect(ready).toEqual({ ready: false, reason: 'Pick a model first.' })
    expect(mockedStatus).not.toHaveBeenCalled()
  })

  it('refuses a version with no model file', async () => {
    const ready = await uploadReadiness(
      recordWith({ model: undefined, atlas: undefined }),
      STUDIO_ID
    )

    expect(ready.ready).toBe(false)
    expect(ready.reason).toBe('This version has no model file.')
  })

  it('refuses a version saved before its spec was kept', async () => {
    const ready = await uploadReadiness(recordWith({ design: null }), STUDIO_ID)

    expect(ready.ready).toBe(false)
    expect(ready.reason).toContain('cannot be rebuilt')
  })

  it('passes the host reason through when no key is saved', async () => {
    mockedStatus.mockResolvedValue({
      success: true,
      data: { configured: false, reason: 'The saved key expired.', userId: null }
    })

    const ready = await uploadReadiness(recordWith(), STUDIO_ID)

    expect(ready).toEqual({ ready: false, reason: 'The saved key expired.' })
  })

  it('falls back to its own wording when the host gives no reason', async () => {
    mockedStatus.mockResolvedValue({
      success: true,
      data: { configured: false, reason: null, userId: null }
    })

    const ready = await uploadReadiness(recordWith(), STUDIO_ID)

    expect(ready.ready).toBe(false)
    expect(ready.reason).toContain('No Open Cloud API key is saved')
  })

  it('refuses a configured key with no creator id', async () => {
    mockedStatus.mockResolvedValue({
      success: true,
      data: { configured: true, reason: null, userId: null }
    })

    const ready = await uploadReadiness(recordWith(), STUDIO_ID)

    expect(ready.ready).toBe(false)
    expect(ready.reason).toBe('No Roblox user id is saved with the key.')
  })

  it('refuses when no place is open, which is the one fix the user makes in Studio', async () => {
    const ready = await uploadReadiness(recordWith(), null)

    expect(ready.ready).toBe(false)
    expect(ready.reason).toBe('Open a place in Roblox Studio first.')
  })

  it('is ready with a spec, a key, a creator and a place', async () => {
    expect(await uploadReadiness(recordWith(), STUDIO_ID)).toEqual({
      ready: true,
      reason: null
    })
  })

  it('surfaces a transport failure rather than claiming readiness', async () => {
    mockedStatus.mockResolvedValue({ success: false, error: 'keychain locked', code: 'KEYCHAIN' })

    const ready = await uploadReadiness(recordWith(), STUDIO_ID)

    expect(ready).toEqual({ ready: false, reason: 'keychain locked' })
  })
})

describe('uploadModelRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpload.mockResolvedValue({
      success: true,
      data: { assetId: 987, message: 'Inserted BlockyHero', recovery: null }
    })
  })

  it('rebuilds the GLB from the spec and sends it as base64', async () => {
    await uploadModelRecord(recordWith(), STUDIO_ID)

    expect(mockedUpload).toHaveBeenCalledTimes(1)
    const sent = mockedUpload.mock.calls[0]![0]

    // A real GLB, not a placeholder: the binary magic is the cheapest proof the
    // rebuild ran instead of the record's file being forwarded.
    const bytes = Uint8Array.from(atob(sent.glbBase64), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('sends the record slug as the asset name and the prompt as the description', async () => {
    await uploadModelRecord(recordWith(), STUDIO_ID)

    const sent = mockedUpload.mock.calls[0]![0]
    expect(sent.name).toBe('blocky-hero')
    expect(sent.description).toBe('a blocky hero')
    expect(sent.studioId).toBe(STUDIO_ID)
  })

  it('falls back to the slug when the version kept no prompt', async () => {
    await uploadModelRecord(recordWith({ prompt: undefined }), STUDIO_ID)

    expect(mockedUpload.mock.calls[0]![0].description).toBe('blocky-hero')
  })

  it('sends an insert script that still holds the placeholder', async () => {
    await uploadModelRecord(recordWith(), STUDIO_ID)

    // The id does not exist until the upload returns, so the script carries the
    // placeholder and the host substitutes it. A literal here would insert the
    // wrong asset.
    const sent = mockedUpload.mock.calls[0]![0]
    expect(sent.luau).toContain(PLACEHOLDER_ASSET_ID)
    expect(sent.luau).toContain('InsertService')
  })

  it('returns the asset id the host reported', async () => {
    const outcome = await uploadModelRecord(recordWith(), STUDIO_ID)

    expect(outcome).toEqual({
      ok: true,
      assetId: 987,
      message: 'Inserted BlockyHero',
      recovery: null
    })
  })

  it('reports an upload that succeeded but an insert that did not', async () => {
    mockedUpload.mockResolvedValue({
      success: true,
      data: {
        assetId: 987,
        message: '',
        recovery: 'Asset 987 uploaded, but the place did not load it.'
      }
    })

    const outcome = await uploadModelRecord(recordWith(), STUDIO_ID)

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.recovery).toContain('did not load it')
  })

  it('refuses a record with no spec without calling the host', async () => {
    const outcome = await uploadModelRecord(recordWith({ design: null }), STUDIO_ID)

    expect(outcome).toMatchObject({ ok: false, code: 'NO_SPEC' })
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('reports a spec that no longer builds instead of throwing', async () => {
    const outcome = await uploadModelRecord(
      recordWith({ design: { ...R15_HERO_EXAMPLE, parts: [] } }),
      STUDIO_ID
    )

    expect(outcome).toMatchObject({ ok: false, code: 'BUILD_FAILED' })
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('passes a host upload failure through with its code', async () => {
    mockedUpload.mockResolvedValue({
      success: false,
      error: 'Roblox rejected the key.',
      code: 'OPENCLOUD_UNAUTHORIZED'
    })

    const outcome = await uploadModelRecord(recordWith(), STUDIO_ID)

    expect(outcome).toEqual({
      ok: false,
      code: 'OPENCLOUD_UNAUTHORIZED',
      reason: 'Roblox rejected the key.'
    })
  })
})
