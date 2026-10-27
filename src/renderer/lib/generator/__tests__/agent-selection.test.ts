import { beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { useAcpStore } from '@/stores/acp-store'
import { resolveGeneratorAgentId } from '../agent-selection'

function reset(overrides: Record<string, unknown> = {}) {
  useAcpStore.setState({
    sessions: {},
    configToLiveAgent: {},
    selectedAgentConfigId: null,
    ...overrides
  } as never)
}

describe('resolveGeneratorAgentId', () => {
  beforeEach(() => reset())

  it('uses the chat session agent when the call names one', () => {
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' }
    })

    expect(resolveGeneratorAgentId('s-1')).toBe('runtime-codex')
  })

  it('uses the selected agent config rather than assuming Claude', () => {
    reset({
      selectedAgentConfigId: 'acp-registry:codex-acp',
      configToLiveAgent: {
        'acp-registry:codex-acp': 'runtime-codex',
        [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude'
      }
    })

    expect(resolveGeneratorAgentId()).toBe('runtime-codex')
  })

  it('falls back to the live Claude agent when nothing is selected', () => {
    reset({ configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' } })

    expect(resolveGeneratorAgentId()).toBe('runtime-claude')
  })

  it('falls back to any live agent when Claude is not the one running', () => {
    reset({ configToLiveAgent: { 'acp-registry:opencode': 'runtime-opencode' } })

    expect(resolveGeneratorAgentId()).toBe('runtime-opencode')
  })

  it('answers null instead of inventing an id when no agent has spawned', () => {
    expect(resolveGeneratorAgentId()).toBeNull()
    expect(resolveGeneratorAgentId('unknown-session')).toBeNull()
  })

  it('ignores a selected config that has no live agent yet', () => {
    reset({ selectedAgentConfigId: 'acp-registry:codex-acp' })

    expect(resolveGeneratorAgentId()).toBeNull()
  })
})
