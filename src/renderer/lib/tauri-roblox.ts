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
export interface RobloxStudioWindow {
  id: string
  name: string | null
}

export interface RobloxStudioLiveStatus {
  installed: boolean
  running: boolean
  connected: boolean
  placeName: string | null
  /** The MCP handle of the open place's window. */
  studioId: string | null
  /** Every other reachable Studio window, so a chat can offer to switch. */
  otherStudios: RobloxStudioWindow[]
}

/**
 * The addressable key for the open place, or `placeKey: null` when it cannot be
 * addressed. Mirrors the Rust `RobloxPlaceKey`.
 */
export interface RobloxPlaceKey {
  placeKey: string | null
  placeId: number
  placeName: string | null
  created: boolean
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
  placeName: null,
  studioId: null,
  otherStudios: []
}

export const ROBLOX_PLACE_KEY_UNAVAILABLE: RobloxPlaceKey = {
  placeKey: null,
  placeId: 0,
  placeName: null,
  created: false
}

export function createRobloxApi(): {
  studioPath: () => Promise<IpcResult<RobloxStudioStatus>>
  workspacePath: () => Promise<IpcResult<string | null>>
  liveStatus: () => Promise<IpcResult<RobloxStudioLiveStatus>>
  placeKey: () => Promise<IpcResult<RobloxPlaceKey>>
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
    },
    placeKey: async () => {
      if (!isTauriContext()) {
        return { success: true, data: ROBLOX_PLACE_KEY_UNAVAILABLE }
      }
      return invokeIpcWrapped<RobloxPlaceKey>('roblox_place_key')
    }
  }
}

export const robloxApi = createRobloxApi()
