import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauri-runtime', () => ({ isTauriContext: vi.fn() }))
vi.mock('@/lib/ipc/tauri', () => ({ invokeIpcWrapped: vi.fn() }))

import { invokeIpcWrapped } from '@/lib/ipc/tauri'
import { isTauriContext } from '@/lib/tauri-runtime'
import { createRobloxApi } from './tauri-roblox'

const mockedIsTauri = vi.mocked(isTauriContext)
const mockedInvoke = vi.mocked(invokeIpcWrapped)

describe('roblox api adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports Studio as unavailable outside the Tauri context without invoking', async () => {
    mockedIsTauri.mockReturnValue(false)

    const result = await createRobloxApi().studioPath()

    expect(result).toEqual({ success: true, data: { found: false, exePath: null } })
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('forwards the host answer in the Tauri context', async () => {
    mockedIsTauri.mockReturnValue(true)
    mockedInvoke.mockResolvedValue({
      success: true,
      data: { found: true, exePath: 'C:/Roblox/Versions/version-abc/StudioMCP.exe' }
    })

    const result = await createRobloxApi().studioPath()

    expect(mockedInvoke).toHaveBeenCalledWith('roblox_studio_path')
    expect(result.data?.found).toBe(true)
  })

  it('surfaces a host failure instead of throwing', async () => {
    mockedIsTauri.mockReturnValue(true)
    mockedInvoke.mockResolvedValue({ success: false, error: 'boom', code: 'UNKNOWN_ERROR' })

    const result = await createRobloxApi().studioPath()

    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
  })
})
