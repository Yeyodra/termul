/**
 * The context block and the rules fill, pinned to the shape RobloxKit sends.
 *
 * A byte-level mismatch here does not fail loudly — it just makes the agent
 * subtly less Roblox-aware — so the exact lines matter.
 */
import { describe, expect, it } from 'vitest'
import {
  acpRules,
  contextBlock,
  fill,
  ROBLOX_MCP_SERVER,
  SKILL_NAMES,
  sessionContext,
  skillNames
} from '@/lib/generator/session-context'

describe('sessionContext', () => {
  it('names the open place, its studio id and the connection state', () => {
    const text = sessionContext({
      studios: [{ id: 'studio-1', name: 'My Obby' }],
      studioId: 'studio-1',
      status: 'connected'
    })

    expect(text).toContain('Robloxkit session context')
    expect(text).toContain('Open place: My Obby (studio_id studio-1)')
    expect(text).toContain('Studio connection: connected')
  })

  it('lists peer windows so the agent can offer to switch', () => {
    const text = sessionContext({
      studios: [
        { id: 'studio-1', name: 'My Obby' },
        { id: 'studio-2', name: 'Test Place' }
      ],
      studioId: 'studio-1',
      status: 'connected'
    })

    expect(text).toContain('Other Studio windows: Test Place')
  })

  it('says none when there are no peers', () => {
    const text = sessionContext({
      studios: [{ id: 'studio-1', name: 'My Obby' }],
      studioId: 'studio-1',
      status: 'connected'
    })

    expect(text).toContain('Other Studio windows: none')
  })

  it('degrades to "none selected" with no place and "unknown" with no status', () => {
    const text = sessionContext({ studios: [] })

    expect(text).toContain('Open place: none selected')
    expect(text).toContain('Studio connection: unknown')
    expect(text).toContain('Other Studio windows: none')
  })

  it('still names every skill when nothing is open', () => {
    const text = sessionContext({ studios: [] })

    expect(text).toContain('Skills to read first: roblox-performance')
    expect(text).toContain('luau-scripting')
    expect(text).toContain('roblox-texturing')
  })

  it('names the MCP server that carries the tools', () => {
    const text = sessionContext({ studios: [] })

    expect(text).toContain(`\`${ROBLOX_MCP_SERVER}\` MCP server`)
  })

  it('is exactly six lines', () => {
    const text = sessionContext({
      studios: [{ id: 's1', name: 'P' }],
      studioId: 's1',
      status: 'connected'
    })

    expect(text.split('\n')).toHaveLength(6)
  })

  it('keeps line order: identity, place, status, peers, skills, tools', () => {
    const lines = sessionContext({ studios: [] }).split('\n')

    expect(lines[0]).toBe('Robloxkit session context')
    expect(lines[1].startsWith('- Open place:')).toBe(true)
    expect(lines[2].startsWith('- Studio connection:')).toBe(true)
    expect(lines[3].startsWith('- Other Studio windows:')).toBe(true)
    expect(lines[4].startsWith('- Skills to read first:')).toBe(true)
    expect(lines[5].startsWith('- Studio and workspace tools')).toBe(true)
  })

  it('falls back to "untitled" for a place with no name yet', () => {
    const text = sessionContext({
      studios: [{ id: 'studio-1', name: null }],
      studioId: 'studio-1'
    })

    expect(text).toContain('Open place: untitled (studio_id studio-1)')
  })
})

describe('skillNames', () => {
  it('lists all 16 ids in declaration order', () => {
    expect(SKILL_NAMES).toHaveLength(16)
    expect(skillNames()).toBe(
      'luau-scripting, luau-debugging, luau-patterns, roblox-ui, roblox-building, roblox-performance, roblox-vfx, roblox-gfx, roblox-icons, roblox-sfx, roblox-cutscenes, roblox-animation, roblox-skybox, roblox-rigging, roblox-textures, roblox-texturing'
    )
  })
})

describe('fill', () => {
  it('substitutes a known placeholder', () => {
    expect(fill('a {{x}} b', { x: 'Y' })).toBe('a Y b')
  })

  it('leaves an unknown placeholder verbatim', () => {
    expect(fill('a {{missing}} b', { x: 'Y' })).toBe('a {{missing}} b')
  })

  it('substitutes every occurrence', () => {
    expect(fill('{{x}} {{x}}', { x: '1' })).toBe('1 1')
  })

  it('ignores non-word keys, as the original regex does', () => {
    expect(fill('{{a b}}', { 'a b': 'no' })).toBe('{{a b}}')
  })
})

describe('acpRules', () => {
  it('substitutes the skill list as bullet lines', () => {
    const out = acpRules('Read: {{skills}}')

    expect(out).toContain('- luau-scripting')
    expect(out).toContain('- roblox-texturing')
    expect(out).not.toContain('{{skills}}')
  })

  it('yields an empty string for an empty rules document', () => {
    expect(acpRules('')).toBe('')
    expect(acpRules('   ')).toBe('')
  })

  it('leaves other placeholders untouched', () => {
    expect(acpRules('{{skills}} and {{other}}')).toContain('{{other}}')
  })
})

describe('contextBlock', () => {
  it('uses a resource block when the adapter embeds context', () => {
    const block = contextBlock('CTX', true)

    expect(block.type).toBe('resource')
    expect(block.resource).toEqual({
      uri: 'robloxkit://studio/context',
      mimeType: 'text/markdown',
      text: 'CTX'
    })
  })

  it('uses a text block otherwise', () => {
    expect(contextBlock('CTX', false)).toEqual({ type: 'text', text: 'CTX' })
  })
})
