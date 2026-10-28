import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCall } from '@/lib/acp-api'
import { attachGeneratedPicture, imageBlockFromDataUrl } from '../attach-picture'

const { store } = vi.hoisted(() => ({
  store: {
    toolCalls: {} as Record<string, ToolCall[]>,
    updates: [] as unknown[]
  }
}))

vi.mock('@/stores/acp-store', () => ({
  useAcpStore: {
    getState: () => ({
      toolCalls: store.toolCalls,
      _onToolCallUpdate: (event: unknown) => store.updates.push(event)
    })
  }
}))

const PNG = 'data:image/png;base64,AAAA'

function call(title: string, extra: Partial<ToolCall> = {}): ToolCall {
  return { toolCallId: `id-${title}`, title, ...extra }
}

describe('imageBlockFromDataUrl', () => {
  it('splits a PNG data URL into the ACP image block', () => {
    expect(imageBlockFromDataUrl(PNG)).toEqual({
      type: 'image',
      data: 'AAAA',
      mimeType: 'image/png'
    })
  })

  it('refuses anything that is not an image data URL', () => {
    expect(imageBlockFromDataUrl('not a data url')).toBeNull()
    expect(imageBlockFromDataUrl('data:text/plain;base64,AAAA')).toBeNull()
  })
})

describe('attachGeneratedPicture', () => {
  beforeEach(() => {
    store.toolCalls = {}
    store.updates = []
  })

  it('adds the picture to the newest settled poll card', () => {
    store.toolCalls['s-1'] = [call('mcp__termul__get_clothing_task')]

    attachGeneratedPicture('s-1', PNG)

    expect(store.updates).toHaveLength(1)
    const update = store.updates[0] as {
      update: { toolCallId: string; content: Array<{ type: string; content: unknown }> }
    }
    expect(update.update.toolCallId).toBe('id-mcp__termul__get_clothing_task')
    expect(update.update.content).toEqual([
      { type: 'content', content: imageBlockFromDataUrl(PNG) }
    ])
  })

  it('does nothing without a picture', () => {
    store.toolCalls['s-1'] = [call('mcp__termul__get_clothing_task')]
    attachGeneratedPicture('s-1', undefined)
    expect(store.updates).toHaveLength(0)
  })

  it('does nothing when the session has no poll card', () => {
    store.toolCalls['s-1'] = [call('mcp__termul__generate_clothing')]
    attachGeneratedPicture('s-1', PNG)
    expect(store.updates).toHaveLength(0)
  })

  it('does not stack a second picture on a card that already shows one', () => {
    store.toolCalls['s-1'] = [
      call('mcp__termul__get_clothing_task', {
        content: [{ type: 'content', content: imageBlockFromDataUrl(PNG)! }]
      })
    ]
    attachGeneratedPicture('s-1', PNG)
    expect(store.updates).toHaveLength(0)
  })

  it('ignores a card whose title is not a clothing poll', () => {
    store.toolCalls['s-1'] = [call('mcp__termul__get_3d_task')]
    attachGeneratedPicture('s-1', PNG)
    expect(store.updates).toHaveLength(0)
  })

  it('picks the newest of several poll cards', () => {
    store.toolCalls['s-1'] = [
      call('mcp__termul__get_clothing_task', { toolCallId: 'old' }),
      call('mcp__termul__get_clothing_task', { toolCallId: 'new' })
    ]
    attachGeneratedPicture('s-1', PNG)
    expect((store.updates[0] as { update: { toolCallId: string } }).update.toolCallId).toBe('new')
  })
})
