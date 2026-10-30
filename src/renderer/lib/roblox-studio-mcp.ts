import { toast } from 'sonner'
import type { StoredMcpServer } from '@/lib/acp-mcp-persistence'
import { robloxApi } from '@/lib/tauri-roblox'
import { useAcpStore } from '@/stores/acp-store'
import { useProjectStore } from '@/stores/project-store'
import type { Project } from '@/types/project'

export const ROBLOX_STUDIO_MCP_ID = 'roblox-studio'
export const ROBLOX_PROJECT_NAME = 'Roblox'

/**
 * The registry stores this token instead of a real `StudioMCP.exe` path. Roblox
 * installs every update under a new `version-<hash>` directory, so a stored path
 * goes stale and the server stops spawning (the badge reads "Unreachable" while
 * a freshly resolved path still works). The backend expands the token through
 * `roblox::resolve_known_command` at every spawn.
 *
 * MUST equal `ROBLOX_STUDIO_MCP_ID`: it doubles as the server name, and the Rust
 * `STUDIO_MCP_COMMAND_TOKEN` must match it too.
 */
export const ROBLOX_STUDIO_MCP_COMMAND = ROBLOX_STUDIO_MCP_ID

export function robloxStudioEntry(): StoredMcpServer {
  return {
    id: ROBLOX_STUDIO_MCP_ID,
    type: 'stdio',
    name: 'roblox-studio',
    command: ROBLOX_STUDIO_MCP_COMMAND,
    args: [],
    env: [],
    enabled: true
  }
}

/**
 * What the registry should hold for the Roblox bridge on this machine.
 *
 * - `none`     — Studio is not installed, or the user deleted the entry on
 *                purpose; leave the registry alone.
 * - `add`      — Studio is installed and the registry has no entry; seed one.
 * - `upgrade`  — the entry still holds an absolute path from an earlier build
 *                (possibly a dead `version-<hash>`); rewrite it to the token.
 */
export type RobloxRegistryAction = 'none' | 'add' | 'upgrade'

/**
 * Decide the action from the registry list plus Studio's presence.
 *
 * Split from the store so the rule is testable without a running app. An entry
 * whose command is already the token is left untouched even when Studio moved to
 * a new version directory, which is the point of the token.
 *
 * `removedByUser` is the persisted opt-out: a user who deleted the entry does
 * not get it back on the next launch.
 */
export function robloxRegistryAction(
  servers: StoredMcpServer[],
  studioInstalled: boolean,
  removedByUser: boolean
): RobloxRegistryAction {
  if (!studioInstalled) return 'none'
  const existing = servers.find((server) => server.id === ROBLOX_STUDIO_MCP_ID)
  if (!existing) return removedByUser ? 'none' : 'add'
  if (existing.type !== 'stdio') return 'none'
  return existing.command === ROBLOX_STUDIO_MCP_COMMAND ? 'none' : 'upgrade'
}

/**
 * Make sure the MCP registry has a usable `roblox-studio` entry, and confirm
 * Studio is actually installed.
 *
 * The entry is compared by command, not by resolved path: a correct entry is
 * the token, so an install that moved to a new `version-<hash>` no longer makes
 * it stale. An entry still holding an old absolute path (written by an earlier
 * build) is rewritten to the token, which repairs it without a user action.
 *
 * Returns the resolved `StudioMCP.exe` path, or `null` after telling the user
 * why. The path is only used for the caller's own checks — it is never stored.
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
  if (
    existing?.type === 'stdio' &&
    existing.command === ROBLOX_STUDIO_MCP_COMMAND &&
    existing.enabled !== false
  ) {
    return command
  }

  await state.saveMcpServer(robloxStudioEntry())
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
