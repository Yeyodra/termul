import type { IpcResult } from '@shared/types/ipc.types'
import { invokeIpcWrapped } from '@/lib/ipc/tauri'
import { isTauriContext } from '@/lib/tauri-runtime'

export interface RobloxStudioStatus {
  found: boolean
  exePath: string | null
}

const NOT_AVAILABLE: RobloxStudioStatus = { found: false, exePath: null }

export function createRobloxApi(): {
  studioPath: () => Promise<IpcResult<RobloxStudioStatus>>
  workspacePath: () => Promise<IpcResult<string | null>>
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
    }
  }
}

export const robloxApi = createRobloxApi()
