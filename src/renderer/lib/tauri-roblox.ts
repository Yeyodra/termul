import type { IpcResult } from '@shared/types/ipc.types'
import { invokeIpcWrapped } from '@/lib/ipc/tauri'
import { isTauriContext } from '@/lib/tauri-runtime'

export interface RobloxStudioStatus {
  found: boolean
  exePath: string | null
}

/**
 * Whether Studio is installed, running and reachable, plus the open place's
 * name. Mirrors the Rust `RobloxStudioLiveStatus` (camelCase on the wire).
 */
export interface RobloxStudioLiveStatus {
  installed: boolean
  running: boolean
  connected: boolean
  placeName: string | null
}

const NOT_AVAILABLE: RobloxStudioStatus = { found: false, exePath: null }

/**
 * No Studio can exist off-desktop (the proxy ships with the Windows Studio
 * install), so the web/server surfaces report the not-installed state instead
 * of a broken one.
 */
export const ROBLOX_LIVE_STATUS_UNAVAILABLE: RobloxStudioLiveStatus = {
  installed: false,
  running: false,
  connected: false,
  placeName: null
}

export function createRobloxApi(): {
  studioPath: () => Promise<IpcResult<RobloxStudioStatus>>
  workspacePath: () => Promise<IpcResult<string | null>>
  liveStatus: () => Promise<IpcResult<RobloxStudioLiveStatus>>
} {
  return {
    studioPath: async () => {
      if (!isTauriContext()) {
        return { success: true, data: NOT_AVAILABLE }
      }
      return invokeIpcWrapped<RobloxStudioStatus>('roblox_studio_path')
    },
    workspacePath: async () => {
      if (!isTauriContext()) {
        return { success: true, data: null }
      }
      return invokeIpcWrapped<string | null>('roblox_workspace_path')
    },
    liveStatus: async () => {
      if (!isTauriContext()) {
        return { success: true, data: ROBLOX_LIVE_STATUS_UNAVAILABLE }
      }
      return invokeIpcWrapped<RobloxStudioLiveStatus>('roblox_studio_live_status')
    }
  }
}

export const robloxApi = createRobloxApi()
