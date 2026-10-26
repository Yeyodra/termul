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
  ROBLOX_STUDIO_MCP_ID,
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

  it('builds a stdio entry with the schema-required empty args and env', () => {
    expect(robloxStudioEntry(EXE)).toEqual({
      id: ROBLOX_STUDIO_MCP_ID,
      type: 'stdio',
      name: 'roblox-studio',
      command: EXE,
      args: [],
      env: [],
      enabled: true
    })
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
    expect(saveMcpServer).toHaveBeenCalledWith(robloxStudioEntry(EXE))
  })

  it('rewrites the entry when Roblox updated to a new version directory', async () => {
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    const stale = robloxStudioEntry('C:/Roblox/Versions/version-old/StudioMCP.exe')
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(stateWith({ mcpServers: [stale], saveMcpServer }) as never)

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).toHaveBeenCalledWith(robloxStudioEntry(EXE))
  })

  it('leaves an up-to-date entry untouched', async () => {
    const saveMcpServer = vi.fn().mockResolvedValue(undefined)
    mockedStudioPath.mockResolvedValue({ success: true, data: { found: true, exePath: EXE } })
    mockedGetState.mockReturnValue(
      stateWith({ mcpServers: [robloxStudioEntry(EXE)], saveMcpServer }) as never
    )

    expect(await ensureRobloxStudioMcp()).toBe(EXE)
    expect(saveMcpServer).not.toHaveBeenCalled()
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
