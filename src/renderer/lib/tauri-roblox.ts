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

/** Whether an Open Cloud key is stored, without revealing it. */
export interface OpenCloudStatus {
  configured: boolean
  /** Why it is not configured, when the reason is not simply "nothing saved". */
  reason: string | null
  /**
   * The numeric Roblox user id the key uploads under, or `null` when none was
   * saved. An upload needs it, and it is not a secret: it is the number in a
   * profile URL.
   */
  userId: string | null
}

/** What an Open Cloud upload produced. */
export interface OpenCloudUpload {
  assetId: number
  /** The insert script's own reply. */
  message: string
  /** Present when the upload worked but the insert did not. */
  recovery: string | null
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
  openCloudStatus: () => Promise<IpcResult<OpenCloudStatus>>
  saveOpenCloudKey: (key: string, userId?: string) => Promise<IpcResult<OpenCloudStatus>>
  clearOpenCloudKey: () => Promise<IpcResult<OpenCloudStatus>>
  uploadModel: (request: {
    glbBase64: string
    name: string
    description?: string
    studioId: string
    luau: string
  }) => Promise<IpcResult<OpenCloudUpload>>
} {
  const OFF_DESKTOP: OpenCloudStatus = { configured: false, reason: null, userId: null }

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
    },
    // The key lives in the OS keychain on the host, so every one of these is
    // desktop-only. Off-desktop the answer is "not configured" rather than an
    // error: there is nothing the renderer could do with one anyway.
    openCloudStatus: async () => {
      if (!isTauriContext()) {
        return { success: true, data: OFF_DESKTOP }
      }
      return invokeIpcWrapped<OpenCloudStatus>('roblox_opencloud_status')
    },
    saveOpenCloudKey: async (key: string, userId?: string) => {
      if (!isTauriContext()) {
        return {
          success: false,
          error: 'An Open Cloud key can only be saved in the desktop app.',
          code: 'DESKTOP_ONLY'
        }
      }
      return invokeIpcWrapped<OpenCloudStatus>('roblox_opencloud_save_key', { key, userId })
    },
    clearOpenCloudKey: async () => {
      if (!isTauriContext()) {
        return { success: true, data: OFF_DESKTOP }
      }
      return invokeIpcWrapped<OpenCloudStatus>('roblox_opencloud_clear_key')
    },
    uploadModel: async (request) => {
      if (!isTauriContext()) {
        return {
          success: false,
          error: 'Uploading a model needs the desktop app.',
          code: 'DESKTOP_ONLY'
        }
      }
      // The creator is not passed: the host reads it from the keychain beside the
      // key, so the two cannot disagree about whose account an asset belongs to.
      return invokeIpcWrapped<OpenCloudUpload>('roblox_upload_model', {
        glbBase64: request.glbBase64,
        name: request.name,
        description: request.description,
        studioId: request.studioId,
        luau: request.luau
      })
    }
  }
}

export const robloxApi = createRobloxApi()
