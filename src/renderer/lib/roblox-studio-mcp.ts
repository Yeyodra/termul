import { toast } from 'sonner'
import type { StoredMcpServer } from '@/lib/acp-mcp-persistence'
import { robloxApi } from '@/lib/tauri-roblox'
import { useAcpStore } from '@/stores/acp-store'
import { useProjectStore } from '@/stores/project-store'
import type { Project } from '@/types/project'

export const ROBLOX_STUDIO_MCP_ID = 'roblox-studio'
export const ROBLOX_PROJECT_NAME = 'Roblox'

export function robloxStudioEntry(command: string): StoredMcpServer {
  return {
    id: ROBLOX_STUDIO_MCP_ID,
    type: 'stdio',
    name: 'roblox-studio',
    command,
    args: [],
    env: [],
    enabled: true
  }
}

/**
 * Resolve `StudioMCP.exe` on this machine and make sure the MCP registry has a
 * matching entry. The path is re-resolved on every call because Roblox installs
 * each update under a new `version-<hash>` directory.
 *
 * Returns the command to use, or `null` after telling the user why.
 */
export async function ensureRobloxStudioMcp(): Promise<string | null> {
  const result = await robloxApi.studioPath()
  if (!result.success) {
    toast.error('Could not look for Roblox Studio', { description: result.error })
    return null
  }

  const command = result.data?.exePath
  if (!result.data?.found || !command) {
    toast.error('Roblox Studio is not installed', {
      description: 'Install Roblox Studio, then open it once so StudioMCP.exe is present.'
    })
    return null
  }

  const state = useAcpStore.getState()
  const existing = state.mcpServers.find((server) => server.id === ROBLOX_STUDIO_MCP_ID)
  if (existing?.type === 'stdio' && existing.command === command && existing.enabled !== false) {
    return command
  }

  await state.saveMcpServer(robloxStudioEntry(command))
  return command
}

/**
 * The launcher lives inside a pane, and a pane only exists inside a project.
 * A Roblox chat needs no workspace of its own, so it reuses a dedicated
 * `Roblox` project, creating it on first use at the host-resolved workspace
 * (`Documents/RobloxKit`, falling back to local app data).
 */
export async function ensureRobloxProject(): Promise<Project | null> {
  const store = useProjectStore.getState()
  const existing = store.projects.find((project) => project.name === ROBLOX_PROJECT_NAME)

  const resolved = await robloxApi.workspacePath()
  if (!resolved.success) {
    toast.error('Could not resolve the Roblox workspace', { description: resolved.error })
    return null
  }
  const workspace = resolved.data
  if (!workspace) {
    toast.error('Could not create the Roblox workspace', {
      description: 'Neither Documents nor the local app data folder is writable.'
    })
    return null
  }

  if (existing) {
    if (existing.path !== workspace) {
      store.updateProject(existing.id, { path: workspace })
    }
    return useProjectStore.getState().projects.find((p) => p.id === existing.id) ?? existing
  }

  try {
    return await store.addProject(ROBLOX_PROJECT_NAME, 'blue', workspace)
  } catch (error) {
    toast.error('Could not create the Roblox project', {
      description: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
