import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLiveStatus, mockIsTauri, mockLogFrontendError, mockFocusListeners } = vi.hoisted(
  () => ({
    mockLiveStatus: vi.fn(),
    mockIsTauri: vi.fn(),
    mockLogFrontendError: vi.fn(),
    mockFocusListeners: [] as Array<(event: { payload: boolean }) => void>
  })
)

vi.mock('@/lib/tauri-roblox', () => ({
  robloxApi: { liveStatus: mockLiveStatus },
  ROBLOX_LIVE_STATUS_UNAVAILABLE: {
    installed: false,
    running: false,
    connected: false,
    placeName: null
  }
}))

vi.mock('@/lib/tauri-runtime', () => ({
  isTauriContext: mockIsTauri,
  cleanupTauriListener: (unlisten: unknown) => {
    if (typeof unlisten === 'function') unlisten()
  }
}))

vi.mock('@/lib/tauri-window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      mockFocusListeners.push(handler)
      return () => {
        const index = mockFocusListeners.indexOf(handler)
        if (index >= 0) mockFocusListeners.splice(index, 1)
      }
    }
  })
}))

vi.mock('@/lib/log-api', () => ({ logFrontendError: mockLogFrontendError }))

import { ROBLOX_POLL_MS, useRobloxStudioStatus } from './use-roblox-studio-status'

const RUNNING = { installed: true, running: true, connected: true, placeName: 'Place A' }
const RUNNING_ONLY = { installed: true, running: true, connected: false, placeName: null }
const STOPPED = { installed: true, running: false, connected: false, placeName: null }

function ok(data: unknown) {
  return { success: true, data }
}

describe('useRobloxStudioStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTauri.mockReturnValue(true)
    mockFocusListeners.length = 0
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not poll at all while disabled', async () => {
    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: false }))

    expect(result.current).toBeNull()
    expect(mockLiveStatus).not.toHaveBeenCalled()
  })

  it('publishes the first answer', async () => {
    mockLiveStatus.mockResolvedValue(ok(RUNNING))

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))

    await waitFor(() => expect(result.current).toEqual(RUNNING))
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)
  })

  it('reads the not-installed state once off-desktop and never invokes', async () => {
    mockIsTauri.mockReturnValue(false)

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))

    await waitFor(() => expect(result.current?.installed).toBe(false))
    expect(mockLiveStatus).not.toHaveBeenCalled()
  })

  it('polls on the short interval while Studio is down', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValue(ok(STOPPED))

    renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(2)
  })

  it('polls on the short interval while Studio is open with no place loaded', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValue(ok(RUNNING_ONLY))

    renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps polling at the same cadence once a place connects', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValue(ok(RUNNING))

    renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(3)
  })

  it('notices Studio closing within one interval instead of a long settled tier', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValueOnce(ok(RUNNING)).mockResolvedValue(ok(STOPPED))

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual(RUNNING)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })

    expect(result.current).toEqual(STOPPED)
  })

  it('recovers a stuck "no place loaded" reading after Studio exits', async () => {
    vi.useFakeTimers()
    // The race a user sees: the proxy answers "no studio" while the editor is
    // still shutting down, then the editor is gone on the next tick.
    mockLiveStatus.mockResolvedValueOnce(ok(RUNNING_ONLY)).mockResolvedValue(ok(STOPPED))

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual(RUNNING_ONLY)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })

    expect(result.current).toEqual(STOPPED)
  })

  it('skips a tick while the previous request is unresolved', async () => {
    vi.useFakeTimers()
    let resolveFirst: (value: unknown) => void = () => {}
    mockLiveStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      })
    )

    renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)

    // The first request is still in flight: this tick must not stack another.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst(ok(STOPPED))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(1)
  })

  it('stops polling and clears the status when it becomes disabled', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValue(ok(RUNNING))

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRobloxStudioStatus({ enabled }),
      { initialProps: { enabled: true } }
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual(RUNNING)

    rerender({ enabled: false })
    expect(result.current).toBeNull()

    const callsAfterDisable = mockLiveStatus.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS * 2)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(callsAfterDisable)
  })

  it('clears the timer on unmount', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValue(ok(RUNNING))

    const { unmount } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsBeforeUnmount = mockLiveStatus.mock.calls.length

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS * 2)
    })
    expect(mockLiveStatus).toHaveBeenCalledTimes(callsBeforeUnmount)
  })

  it('keeps the last answer and logs when the transport fails', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockResolvedValueOnce(ok(RUNNING)).mockResolvedValue({
      success: false,
      error: 'ipc down',
      code: 'UNKNOWN_ERROR'
    })

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual(RUNNING)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROBLOX_POLL_MS)
    })
    expect(result.current).toEqual(RUNNING)
    expect(mockLogFrontendError).toHaveBeenCalled()
  })

  it('logs a thrown request instead of letting it escape', async () => {
    vi.useFakeTimers()
    mockLiveStatus.mockRejectedValueOnce(new Error('kaboom'))

    const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current).toBeNull()
    expect(mockLogFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'useRobloxStudioStatus' })
    )
  })

  describe('refresh on return to Termul', () => {
    it('re-reads at once when the window regains focus, without waiting the interval', async () => {
      vi.useFakeTimers()
      mockLiveStatus.mockResolvedValueOnce(ok(STOPPED)).mockResolvedValue(ok(RUNNING))

      const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current).toEqual(STOPPED)

      // The user opened Studio; no interval has elapsed yet.
      await act(async () => {
        for (const handler of mockFocusListeners) handler({ payload: true })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockLiveStatus).toHaveBeenCalledTimes(2)
      expect(result.current).toEqual(RUNNING)
    })

    it('ignores a focus loss', async () => {
      vi.useFakeTimers()
      mockLiveStatus.mockResolvedValue(ok(RUNNING))

      renderHook(() => useRobloxStudioStatus({ enabled: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        for (const handler of mockFocusListeners) handler({ payload: false })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockLiveStatus).toHaveBeenCalledTimes(1)
    })

    it('re-reads when the document becomes visible again', async () => {
      vi.useFakeTimers()
      mockLiveStatus.mockResolvedValueOnce(ok(STOPPED)).mockResolvedValue(ok(RUNNING))

      const { result } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockLiveStatus).toHaveBeenCalledTimes(2)
      expect(result.current).toEqual(RUNNING)
    })

    it('does not re-read on visibilitychange while the document is still hidden', async () => {
      vi.useFakeTimers()
      mockLiveStatus.mockResolvedValue(ok(RUNNING))
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden'
      })

      renderHook(() => useRobloxStudioStatus({ enabled: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockLiveStatus).toHaveBeenCalledTimes(1)
    })

    it('drops the focus listener on unmount', async () => {
      vi.useFakeTimers()
      mockLiveStatus.mockResolvedValue(ok(RUNNING))

      const { unmount } = renderHook(() => useRobloxStudioStatus({ enabled: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mockFocusListeners).toHaveLength(1)

      unmount()

      expect(mockFocusListeners).toHaveLength(0)
    })
  })
})
