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

  describe('liveStatus', () => {
    it('reports the not-installed state outside the Tauri context without invoking', async () => {
      mockedIsTauri.mockReturnValue(false)

      const result = await createRobloxApi().liveStatus()

      expect(result).toEqual({
        success: true,
        data: { installed: false, running: false, connected: false, placeName: null }
      })
      expect(mockedInvoke).not.toHaveBeenCalled()
    })

    it('forwards the host answer in the Tauri context', async () => {
      mockedIsTauri.mockReturnValue(true)
      const live = {
        installed: true,
        running: true,
        connected: true,
        placeName: 'Untitled Experience (placeId: 93291914711483)'
      }
      mockedInvoke.mockResolvedValue({ success: true, data: live })

      const result = await createRobloxApi().liveStatus()

      expect(mockedInvoke).toHaveBeenCalledWith('roblox_studio_live_status')
      expect(result.data).toEqual(live)
    })

    it('keeps the four status fields intact when Studio is closed', async () => {
      mockedIsTauri.mockReturnValue(true)
      const live = { installed: true, running: false, connected: false, placeName: null }
      mockedInvoke.mockResolvedValue({ success: true, data: live })

      const result = await createRobloxApi().liveStatus()

      expect(result.success).toBe(true)
      expect(result.data).toEqual(live)
    })

    it('surfaces a host failure instead of throwing', async () => {
      mockedIsTauri.mockReturnValue(true)
      mockedInvoke.mockResolvedValue({ success: false, error: 'boom', code: 'UNKNOWN_ERROR' })

      const result = await createRobloxApi().liveStatus()

      expect(result.success).toBe(false)
      expect(result.error).toBe('boom')
    })
  })
})
