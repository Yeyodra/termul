import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ArtifactRecord,
  currentVersion,
  loadArtifactRecords,
  parseRecord,
  readAtlasDataUrl,
  readStillDataUrl,
  restoreVersion
} from './artifact-records'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    readAttachmentBytes: vi.fn(),
    writeFile: vi.fn()
  }
}))

vi.mock('@/lib/filesystem-api', () => ({
  filesystemApi: {
    readDirectory: mocks.readDirectory,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile
  }
}))

vi.mock('@/lib/attachment-api', () => ({
  readAttachmentBytes: mocks.readAttachmentBytes
}))

const dir = (name: string) => ({
  name,
  path: `/p/${name}`,
  type: 'directory',
  extension: null,
  size: 0,
  modifiedAt: 0
})

function recordText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    slug: 'royal-robe',
    kind: 'shirt',
    current: 2,
    createdAt: 1000,
    updatedAt: 2000,
    versions: [
      {
        n: 1,
        at: 1000,
        prompt: 'first',
        ok: true,
        design: { type: 'shirt' },
        atlas: 'v1.png',
        still: 'v1.still.png'
      },
      { n: 2, at: 2000, prompt: 'second', ok: true, atlas: 'v2.png', still: 'v2.still.png' }
    ],
    ...overrides
  })
}

describe('parseRecord', () => {
  it('reads a record a generation wrote', () => {
    const record = parseRecord(recordText(), '/p/.termul/generated/shirt/royal-robe')
    expect(record).not.toBeNull()
    expect(record!.slug).toBe('royal-robe')
    expect(record!.kind).toBe('shirt')
    expect(record!.current).toBe(2)
    expect(record!.versions).toHaveLength(2)
    expect(record!.itemPath).toBe('/p/.termul/generated/shirt/royal-robe/item.json')
  })

  it('refuses text that is not JSON, and a record with no usable version', () => {
    expect(parseRecord('not json', '/p/x')).toBeNull()
    expect(parseRecord(JSON.stringify({ slug: 'a', versions: [] }), '/p/x')).toBeNull()
    expect(parseRecord(JSON.stringify({ versions: [{ n: 1 }] }), '/p/x')).toBeNull()
  })

  it('falls back to the directory name when the record carries no slug', () => {
    const record = parseRecord(
      recordText({ slug: undefined }),
      '/p/.termul/generated/shirt/royal-robe'
    )
    expect(record!.slug).toBe('royal-robe')
  })
})

describe('currentVersion', () => {
  it('follows the pointer, and falls back to the newest', () => {
    const record = parseRecord(recordText(), '/p/x')!
    expect(currentVersion(record).n).toBe(2)

    const restored = parseRecord(recordText({ current: 1 }), '/p/x')!
    expect(currentVersion(restored).n).toBe(1)

    const dangling = parseRecord(recordText({ current: 99 }), '/p/x')!
    expect(currentVersion(dangling).n).toBe(2)
  })
})

describe('loadArtifactRecords', () => {
  beforeEach(() => {
    mocks.readDirectory.mockReset()
    mocks.readFile.mockReset()
  })

  it('walks two levels and sorts the newest record first', async () => {
    mocks.readDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith('.termul/generated')) {
        return { success: true, data: [dir('shirt')] }
      }
      return { success: true, data: [dir('old'), dir('fresh')] }
    })
    mocks.readFile.mockImplementation(async (path: string) => {
      const fresh = path.includes('/fresh/')
      return {
        success: true,
        data: {
          content: recordText({
            slug: fresh ? 'fresh' : 'old',
            updatedAt: fresh ? 5000 : 1000
          }),
          encoding: 'utf-8',
          size: 1,
          modifiedAt: 0
        }
      }
    })

    const records = await loadArtifactRecords('/p')
    expect(records.map((record) => record.slug)).toEqual(['fresh', 'old'])
  })

  it('skips a record it cannot read instead of hiding the others', async () => {
    mocks.readDirectory.mockImplementation(async (path: string) =>
      path.endsWith('.termul/generated')
        ? { success: true, data: [dir('shirt')] }
        : { success: true, data: [dir('broken'), dir('good')] }
    )
    mocks.readFile.mockImplementation(async (path: string) =>
      path.includes('/broken/')
        ? {
            success: true,
            data: { content: 'not json', encoding: 'utf-8', size: 1, modifiedAt: 0 }
          }
        : {
            success: true,
            data: {
              content: recordText({ slug: 'good' }),
              encoding: 'utf-8',
              size: 1,
              modifiedAt: 0
            }
          }
    )

    const records = await loadArtifactRecords('/p')
    expect(records.map((record) => record.slug)).toEqual(['good'])
  })

  it('returns nothing when the project has no generated folder', async () => {
    mocks.readDirectory.mockResolvedValue({
      success: false,
      error: 'missing',
      code: 'READ_DIR_ERROR'
    })
    expect(await loadArtifactRecords('/p')).toEqual([])
  })

  it('honours the limit', async () => {
    mocks.readDirectory.mockImplementation(async (path: string) =>
      path.endsWith('.termul/generated')
        ? { success: true, data: [dir('shirt')] }
        : { success: true, data: [dir('a'), dir('b'), dir('c')] }
    )
    mocks.readFile.mockResolvedValue({
      success: true,
      data: { content: recordText(), encoding: 'utf-8', size: 1, modifiedAt: 0 }
    })
    expect(await loadArtifactRecords('/p', 2)).toHaveLength(2)
  })
})

describe('reading a version picture', () => {
  const record: ArtifactRecord = parseRecord(recordText(), '/p/.termul/generated/shirt/royal-robe')!

  beforeEach(() => {
    mocks.readAttachmentBytes.mockReset()
  })

  it('turns the atlas into a PNG data URL', async () => {
    mocks.readAttachmentBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    const url = await readAtlasDataUrl(record, record.versions[1]!)
    expect(url).toBe('data:image/png;base64,iVBORw==')
    expect(mocks.readAttachmentBytes).toHaveBeenCalledWith(
      '/p/.termul/generated/shirt/royal-robe/v2.png'
    )
  })

  it('returns null when the atlas is gone rather than throwing', async () => {
    mocks.readAttachmentBytes.mockRejectedValue(new Error('ENOENT'))
    expect(await readAtlasDataUrl(record, record.versions[1]!)).toBeNull()
  })

  it('reads the review sheet, and gives up when the version has none', async () => {
    mocks.readAttachmentBytes.mockResolvedValue(new Uint8Array([1]))
    expect(await readStillDataUrl(record, record.versions[0]!)).toContain('data:image/png')
    expect(await readStillDataUrl(record, { ...record.versions[0]!, still: undefined })).toBeNull()
  })
})

describe('restoreVersion', () => {
  const record: ArtifactRecord = parseRecord(recordText(), '/p/.termul/generated/shirt/royal-robe')!

  beforeEach(() => {
    mocks.readAttachmentBytes.mockReset()
    mocks.readFile.mockReset()
    mocks.writeFile.mockReset()
    mocks.readAttachmentBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    mocks.readFile.mockResolvedValue({
      success: true,
      data: { content: recordText(), encoding: 'utf8', size: 1, modifiedAt: 0, contentHash: 'abc' }
    })
    mocks.writeFile.mockResolvedValue({ success: true, data: undefined })
  })

  it('moves the pointer and writes item.json back', async () => {
    expect(await restoreVersion(record, 1)).toEqual({ ok: true })

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = mocks.writeFile.mock.calls[0] as [string, string]
    expect(path).toBe('/p/.termul/generated/shirt/royal-robe/item.json')
    const written = JSON.parse(content)
    expect(written.current).toBe(1)
    expect(written.versions).toHaveLength(2)
    expect(written.updatedAt).toBeGreaterThan(record.updatedAt)
  })

  it('sends the read hash as the write precondition', async () => {
    await restoreVersion(record, 1)
    const [, , options] = mocks.writeFile.mock.calls[0] as [string, string, unknown]
    expect(options).toEqual({ expected: { sha256: 'abc' } })
  })

  it('omits the precondition when the read carried no hash, as on desktop', async () => {
    mocks.readFile.mockResolvedValue({
      success: true,
      data: { content: recordText(), encoding: 'utf8', size: 1, modifiedAt: 0 }
    })
    await restoreVersion(record, 1)
    const [, , options] = mocks.writeFile.mock.calls[0] as [string, string, unknown]
    expect(options).toBeUndefined()
  })

  it('refuses a version the record does not hold', async () => {
    expect(await restoreVersion(record, 9)).toMatchObject({ ok: false, reason: 'missing-version' })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('refuses a version whose atlas is gone instead of leaving the viewport blank', async () => {
    mocks.readAttachmentBytes.mockRejectedValue(new Error('ENOENT'))
    expect(await restoreVersion(record, 1)).toMatchObject({ ok: false, reason: 'no-atlas' })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('reports a conflict when the file changed under it', async () => {
    mocks.writeFile.mockResolvedValue({
      success: false,
      error: 'changed since read',
      code: 'PRECONDITION_FAILED'
    })
    expect(await restoreVersion(record, 1)).toMatchObject({ ok: false, reason: 'conflict' })
  })

  it('refuses to write over a record it cannot parse', async () => {
    mocks.readFile.mockResolvedValue({
      success: true,
      data: { content: 'not json', encoding: 'utf8', size: 1, modifiedAt: 0 }
    })
    expect(await restoreVersion(record, 1)).toMatchObject({ ok: false, reason: 'write-failed' })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })
})
