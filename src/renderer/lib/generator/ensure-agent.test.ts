/**
 * The agent a generation spawns itself.
 *
 * The bug this pins: a stored config carries a local `id` for durable session
 * matching, and the host's `AgentConfig` is `deny_unknown_fields`. Sending the
 * stored object whole was rejected with "unknown field `id`", so every
 * generation from a feature page failed with "could not start Claude Agent"
 * before the model was ever asked anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    resolveGeneratorAgent: vi.fn(),
    spawnAgent: vi.fn(),
    agentConfigs: [] as unknown[],
    selectedAgentConfigId: null as string | null,
    activeProjectId: 'proj-1' as string | null
  }
}))

vi.mock('@/lib/generator/agent-selection', () => ({
  resolveGeneratorAgent: mocks.resolveGeneratorAgent
}))

vi.mock('@/stores/acp-store', () => ({
  useAcpStore: {
    getState: () => ({
      agentConfigs: mocks.agentConfigs,
      selectedAgentConfigId: mocks.selectedAgentConfigId,
      spawnAgent: mocks.spawnAgent
    })
  }
}))

vi.mock('@/stores/project-store', () => ({
  useProjectStore: { getState: () => ({ activeProjectId: mocks.activeProjectId }) }
}))

import { ensureAgentForGeneration } from './ensure-agent'

/** A stored config, which is a launch config plus a local id. */
const STORED = {
  id: 'local-abc',
  configId: 'claude',
  name: 'Claude Agent',
  command: '/usr/bin/claude',
  args: ['--acp'],
  env: { A: '1' },
  allowTerminal: true
}

describe('ensureAgentForGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGeneratorAgent.mockReturnValue(null)
    mocks.agentConfigs = [STORED]
    mocks.selectedAgentConfigId = 'local-abc'
    mocks.activeProjectId = 'proj-1'
    mocks.spawnAgent.mockResolvedValue('agent-1')
  })

  it('reuses a live agent instead of spawning a second process', async () => {
    mocks.resolveGeneratorAgent.mockReturnValue({ id: 'agent-live' })

    const result = await ensureAgentForGeneration('/p')

    expect(result).toEqual({ status: 'ready', agentId: 'agent-live' })
    expect(mocks.spawnAgent).not.toHaveBeenCalled()
  })

  it('sends only the launch fields, never the local id', async () => {
    await ensureAgentForGeneration('/p')

    expect(mocks.spawnAgent).toHaveBeenCalledTimes(1)
    const sent = mocks.spawnAgent.mock.calls[0]![0] as Record<string, unknown>
    // The host rejects an unknown field, so `id` must not travel.
    expect(sent).not.toHaveProperty('id')
    expect(sent).toEqual({
      configId: 'claude',
      name: 'Claude Agent',
      command: '/usr/bin/claude',
      args: ['--acp'],
      env: { A: '1' },
      allowTerminal: true
    })
  })

  it('passes the active project so the spawn is bound to it', async () => {
    await ensureAgentForGeneration('/p')
    expect(mocks.spawnAgent.mock.calls[0]![1]).toBe('proj-1')
  })

  it('says there is no agent when none is configured', async () => {
    mocks.agentConfigs = []

    const result = await ensureAgentForGeneration('/p')

    expect(result.status).toBe('none')
    expect(result).toHaveProperty('reason', expect.stringContaining('No agent is configured'))
    expect(mocks.spawnAgent).not.toHaveBeenCalled()
  })

  it('surfaces the host reason instead of a bare failure', async () => {
    mocks.spawnAgent.mockRejectedValue(new Error('malformed spawn_agent payload'))

    const result = await ensureAgentForGeneration('/p')

    expect(result.status).toBe('none')
    expect(result).toHaveProperty(
      'reason',
      'Could not start Claude Agent: malformed spawn_agent payload'
    )
  })
})
