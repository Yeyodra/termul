import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()

vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))
vi.mock('@/lib/tauri-roblox', () => ({
  robloxApi: { studioPath: vi.fn(), workspacePath: vi.fn() }
}))
vi.mock('@/stores/acp-store', () => ({ useAcpStore: { getState: vi.fn() } }))
vi.mock('@/stores/project-store', () => ({ useProjectStore: { getState: vi.fn() } }))

import { robloxApi } from '@/lib/tauri-roblox'
import { useAcpStore } from '@/stores/acp-store'
import { useProjectStore } from '@/stores/project-store'
import {
  ensureRobloxProject,
  ensureRobloxStudioMcp,
  ROBLOX_PROJECT_NAME,
  ROBLOX_STUDIO_MCP_COMMAND,
  ROBLOX_STUDIO_MCP_ID,
  robloxRegistryAction,
  robloxStudioEntry
} from './roblox-studio-mcp'

const mockedStudioPath = vi.mocked(robloxApi.studioPath)
const mockedWorkspacePath = vi.mocked(robloxApi.workspacePath)
const mockedGetState = vi.mocked(useAcpStore.getState)
const mockedProjectState = vi.mocked(useProjectStore.getState)

function stateWith(overrides: Record<string, unknown> = {}): unknown {
  return { mcpServers: [], saveMcpServer: vi.fn(), ...overrides }
}

const EXE = 'C:/Roblox/Versions/version-abc/StudioMCP.exe'
const WORKSPACE = '/home/u/Documents/RobloxKit'

describe('roblox studio MCP registry entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the stable token instead of a version-specific path', () => {
    expect(robloxStudioEntry()).toEqual({
      id: ROBLOX_STUDIO_MCP_ID,
      type: 'stdio',
      name: 'roblox-studio',
      command: ROBLOX_STUDIO_MCP_COMMAND,
      args: [],
      env: [],
      enabled: true
    })
    // A stored path would go stale on the next Roblox update.
    expect(robloxStudioEntry().command).not.toContain('Versions')
  })

  it('returns null and warns when Studio is not installed', async () => {
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: false, exePath: null } })

    expect(await ensureRobloxStudioMcp()).toBeNull()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('returns null when discovery itself fails', async () => {
    mockedStudioPath.mockResolvedValue({ success: false, error: 'nope', code: 'UNKNOWN_ERROR' })

    expect(await ensureRobloxStudioMcp()).toBeNull()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('saves the entry when the registry has none', async () => {
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(stateWith({ saveMcpServer }) as never)

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).toHaveBeenCalledWith(robloxStudioEntry())
  })

  it('repairs an entry left holding a stale absolute path', async () => {
    // Written by an earlier build: the version directory it names is gone, so
    // the spawn fails and the badge reads Unreachable until this rewrites it.
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    const stale = {
      ...robloxStudioEntry(),
      command: 'C:/Roblox/Versions/version-old/StudioMCP.exe'
    }
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(stateWith({ mcpServers: [stale], saveMcpServer }) as never)

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).toHaveBeenCalledWith(robloxStudioEntry())
  })

  it('leaves an up-to-date entry untouched after a Roblox update moved the exe', async () => {
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(
      stateWith({ mcpServers: [robloxStudioEntry()], saveMcpServer }) as never
    )

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).not.toHaveBeenCalled()
  })

  it('rewrites a disabled entry so the bridge comes back', async () => {
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    const disabled = { ...robloxStudioEntry(), enabled: false }
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(stateWith({ mcpServers: [disabled], saveMcpServer }) as never)

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).toHaveBeenCalledWith(robloxStudioEntry())
  })
})

describe('roblox registry reconcile decision', () => {
  const stalePath = {
    ...robloxStudioEntry(),
    command: 'C:/Roblox/Versions/version-old/StudioMCP.exe'
  }

  it('seeds the entry on a machine with Studio and an empty registry', () => {
    expect(robloxRegistryAction([], true, false)).toBe('add')
  })

  it('never seeds on a machine without Studio', () => {
    expect(robloxRegistryAction([], false, false)).toBe('none')
  })

  it('honours a deletion the user made on purpose', () => {
    expect(robloxRegistryAction([], true, true)).toBe('none')
  })

  it('repairs an entry that still holds an absolute path', () => {
    expect(robloxRegistryAction([stalePath], true, false)).toBe('upgrade')
  })

  it('repairs a stale path even after the user opted out once', () => {
    // Opt-out only stops seeding a missing entry; an existing broken entry is
    // still worth fixing, otherwise the badge stays red forever.
    expect(robloxRegistryAction([stalePath], true, true)).toBe('upgrade')
  })

  it('leaves a correct token entry untouched after Roblox updates', () => {
    expect(robloxRegistryAction([robloxStudioEntry()], true, false)).toBe('none')
    expect(robloxRegistryAction([robloxStudioEntry()], true, true)).toBe('none')
  })

  it('leaves other servers and non-stdio entries alone', () => {
    const other = { ...robloxStudioEntry(), id: 'dokploy', name: 'dokploy', command: 'npx' }
    const http = {
      id: ROBLOX_STUDIO_MCP_ID,
      type: 'http' as const,
      name: 'roblox-studio',
      url: 'http://x'
    }

    expect(robloxRegistryAction([other], true, false)).toBe('add')
    expect(robloxRegistryAction([http as never], true, false)).toBe('none')
  })
})

describe('roblox project bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reuses an existing Roblox project at the resolved workspace', async () => {
    const existing = { id: 'p1', name: ROBLOX_PROJECT_NAME, color: 'blue', path: WORKSPACE }
    const addProject = vi.fn()
    const updateProject = vi.fn()
    mockedWorkspacePath.mockResolvedValue({ success: true, data: WORKSPACE })
    mockedProjectState.mockReturnValue({ projects: [existing], addProject, updateProject } as never)

    expect(await ensureRobloxProject()).toEqual(existing)
    expect(addProject).not.toHaveBeenCalled()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it('repoints an existing project when the workspace moved', async () => {
    const stale = { id: 'p1', name: ROBLOX_PROJECT_NAME, color: 'blue', path: '/old/RobloxKit' }
    const updateProject = vi.fn()
    mockedWorkspacePath.mockResolvedValue({ success: true, data: WORKSPACE })
    mockedProjectState.mockReturnValue({
      projects: [stale],
      addProject: vi.fn(),
      updateProject
    } as never)

    await ensureRobloxProject()

    expect(updateProject).toHaveBeenCalledWith('p1', { path: WORKSPACE })
  })

  it('creates the Roblox project at the resolved workspace on first use', async () => {
    const created = { id: 'p2', name: ROBLOX_PROJECT_NAME, color: 'blue', path: WORKSPACE }
    const addProject = vi.fn().mockResolvedValue(created)
    mockedWorkspacePath.mockResolvedValue({ success: true, data: WORKSPACE })
    mockedProjectState.mockReturnValue({
      projects: [],
      addProject,
      updateProject: vi.fn()
    } as never)

    expect(await ensureRobloxProject()).toEqual(created)
    expect(addProject).toHaveBeenCalledWith(ROBLOX_PROJECT_NAME, 'blue', WORKSPACE)
  })

  it('warns instead of creating when no workspace could be created', async () => {
    const addProject = vi.fn()
    mockedWorkspacePath.mockResolvedValue({ success: true, data: null })
    mockedProjectState.mockReturnValue({
      projects: [],
      addProject,
      updateProject: vi.fn()
    } as never)

    expect(await ensureRobloxProject()).toBeNull()
    expect(addProject).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('surfaces a workspace resolution failure', async () => {
    const addProject = vi.fn()
    mockedWorkspacePath.mockResolvedValue({ success: false, error: 'nope', code: 'UNKNOWN_ERROR' })
    mockedProjectState.mockReturnValue({
      projects: [],
      addProject,
      updateProject: vi.fn()
    } as never)

    expect(await ensureRobloxProject()).toBeNull()
    expect(addProject).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('surfaces a creation failure instead of throwing', async () => {
    const addProject = vi.fn().mockRejectedValue(new Error('registry down'))
    mockedWorkspacePath.mockResolvedValue({ success: true, data: WORKSPACE })
    mockedProjectState.mockReturnValue({
      projects: [],
      addProject,
      updateProject: vi.fn()
    } as never)

    expect(await ensureRobloxProject()).toBeNull()
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
