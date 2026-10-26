import { useEffect, useRef, useState } from 'react'
import { logFrontendError } from '@/lib/log-api'
import {
  ROBLOX_LIVE_STATUS_UNAVAILABLE,
  type RobloxStudioLiveStatus,
  robloxApi
} from '@/lib/tauri-roblox'
import { cleanupTauriListener, isTauriContext } from '@/lib/tauri-runtime'
import { getCurrentWindow } from '@/lib/tauri-window'

/**
 * Poll interval for every state. A tick is a ~1 ms process-name snapshot when
 * Studio is closed and a 1-2 ms call on the warm child when it is open, so a
 * flat short interval costs nothing measurable.
 *
 * There is deliberately no longer "settled" tier. Closing Studio is a transition
 * the user is watching for, and a 30 s tier left the lamp reading a stale
 * "no place loaded" for up to half a minute after Studio was already gone.
 */
export const ROBLOX_POLL_MS = 3_000

interface UseRobloxStudioStatusOptions {
  /** Poll only while true. A non-Roblox project must not poll at all. */
  enabled: boolean
}

/**
 * Live Roblox Studio status for the status-bar lamp.
 *
 * Polls on a flat short interval. Tiered polling looked cheaper but made the
 * state that matters most — Studio closing — the slowest to notice, so the lamp
 * could sit on a stale reading for up to half a minute.
 *
 * Timers alone are still not enough. A window occluded by Roblox Studio (or
 * minimized) gets its timers throttled by the webview, so a lamp can sit stale
 * for minutes and only correct itself on the next remount — which is exactly
 * what a user switching to Studio to load a place then switching back sees. The
 * hook therefore also re-checks on window focus and on `visibilitychange`, so
 * returning to Termul always refreshes immediately.
 *
 * Returns `null` until the first answer lands, and whenever polling is off, so
 * the indicator can render nothing instead of a misleading "not running".
 */
export function useRobloxStudioStatus({
  enabled
}: UseRobloxStudioStatusOptions): RobloxStudioLiveStatus | null {
  const [status, setStatus] = useState<RobloxStudioLiveStatus | null>(null)
  // One in-flight request at a time: a tick that fires while the previous is
  // unresolved is skipped rather than queued.
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setStatus(null)
      return
    }
    // Off-desktop there is no Studio to poll; the adapter already answers the
    // not-installed state, so one read is enough.
    if (!isTauriContext()) {
      setStatus(ROBLOX_LIVE_STATUS_UNAVAILABLE)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (): void => {
      clearTimer()
      timer = setTimeout(() => void tick(), ROBLOX_POLL_MS)
    }

    const tick = async (): Promise<void> => {
      if (cancelled) return
      if (inFlightRef.current) {
        // A slow host must not stack requests; try again on the next interval.
        schedule()
        return
      }
      inFlightRef.current = true
      try {
        const result = await robloxApi.liveStatus()
        if (cancelled) return
        if (result.success && result.data) {
          setStatus(result.data)
        } else {
          // A transport failure is not "Studio is gone": keep the last answer
          // and retry on the next tick so a transient IPC error heals.
          logFrontendError({
            level: 'warn',
            message: `useRobloxStudioStatus: liveStatus failed: ${result.success ? 'no data' : result.error}`,
            source: 'useRobloxStudioStatus'
          })
        }
      } catch (error) {
        if (cancelled) return
        logFrontendError({
          level: 'warn',
          message: `useRobloxStudioStatus: liveStatus threw: ${error instanceof Error ? error.message : String(error)}`,
          source: 'useRobloxStudioStatus'
        })
      } finally {
        inFlightRef.current = false
        if (!cancelled) schedule()
      }
    }

    // Coming back to Termul is the moment the answer is most likely stale, so
    // read at once instead of waiting out whatever delay the timer had left.
    // `onFocusChanged` replays the current focus on subscribe, so this can fire
    // during the first tick; `inFlightRef` collapses that into one request.
    const refreshNow = (): void => {
      if (document.visibilityState !== 'visible') return
      clearTimer()
      void tick()
    }

    void tick()

    const appWindow = getCurrentWindow()
    const focusUnlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) refreshNow()
    })
    document.addEventListener('visibilitychange', refreshNow)

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', refreshNow)
      cleanupTauriListener(focusUnlisten)
    }
  }, [enabled])

  return status
}
