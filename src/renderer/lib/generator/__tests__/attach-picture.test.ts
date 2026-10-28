import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachGeneratedPicture, imageBlockFromDataUrl } from '../attach-picture'

const { store } = vi.hoisted(() => ({
  store: {
    messages: {} as Record<string, Array<{ id: string; role: string; blocks: unknown[] }>>,
    appended: [] as Array<{ sessionId: string; messageId: string; block: unknown }>
  }
}))

vi.mock('@/stores/acp-store', () => ({
  useAcpStore: {
    getState: () => ({
      messages: store.messages,
      appendBlockToMessage: (sessionId: string, messageId: string, block: unknown) =>
        store.appended.push({ sessionId, messageId, block })
    })
  }
}))

const PNG = 'data:image/png;base64,AAAA'

function message(id: string, role: string, blocks: unknown[] = []) {
  return { id, role, blocks }
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
    store.messages = {}
    store.appended = []
  })

  it('appends the picture to the newest agent reply', () => {
    store.messages['s-1'] = [message('u1', 'user'), message('a1', 'agent')]

    attachGeneratedPicture('s-1', PNG)

    expect(store.appended).toHaveLength(1)
    expect(store.appended[0]).toEqual({
      sessionId: 's-1',
      messageId: 'a1',
      block: imageBlockFromDataUrl(PNG)
    })
  })

  it('picks the newest agent reply, skipping a later user message', () => {
    store.messages['s-1'] = [message('a1', 'agent'), message('a2', 'agent'), message('u2', 'user')]

    attachGeneratedPicture('s-1', PNG)

    expect(store.appended[0]?.messageId).toBe('a2')
  })

  it('does nothing without a picture', () => {
    store.messages['s-1'] = [message('a1', 'agent')]
    attachGeneratedPicture('s-1', undefined)
    expect(store.appended).toHaveLength(0)
  })

  it('does nothing when the session has no agent reply yet', () => {
    store.messages['s-1'] = [message('u1', 'user')]
    attachGeneratedPicture('s-1', PNG)
    expect(store.appended).toHaveLength(0)
  })

  it('does not stack a second picture on a reply that already shows one', () => {
    store.messages['s-1'] = [
      message('a1', 'agent', [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }])
    ]
    attachGeneratedPicture('s-1', PNG)
    expect(store.appended).toHaveLength(0)
  })

  it('ignores a session the store does not know', () => {
    attachGeneratedPicture('missing', PNG)
    expect(store.appended).toHaveLength(0)
  })
})
