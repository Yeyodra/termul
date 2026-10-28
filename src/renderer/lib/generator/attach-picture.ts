/**
 * Puts the rendered picture on the agent reply that asked for it.
 *
 * The generator runs through the MCP child, so its result reaches the agent, not
 * the transcript: `child.rs` lifts `image` into an image content block for the
 * model, and nothing carries it back to the chat. The renderer holds the bytes
 * already (`readClothingResult` returns them), so it appends them to the newest
 * agent message of the session, where the bubble renders media.
 */

import type { ContentBlock } from '@/lib/acp-api'
import { useAcpStore } from '@/stores/acp-store'
import type { ChatMessage } from '@/stores/acp-store/types'

/** `data:image/png;base64,…` into the block shape ACP uses on the wire. */
export function imageBlockFromDataUrl(dataUrl: string): ContentBlock | null {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return null
  const head = dataUrl.slice(0, comma)
  if (!head.startsWith('data:image/')) return null
  const mimeType = head.slice('data:'.length).split(';')[0] || 'image/png'
  return { type: 'image', data: dataUrl.slice(comma + 1), mimeType }
}

function newestAgentMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'agent') return messages[i]
  }
  return undefined
}

function alreadyShowsPicture(message: ChatMessage): boolean {
  return message.blocks.some((block) => block.type === 'image')
}

/**
 * Append `image` to the newest agent reply of `sessionId`. Does nothing when that
 * reply already carries a picture, so a repeated poll does not stack duplicates.
 */
export function attachGeneratedPicture(sessionId: string, image?: string): void {
  if (!image) return
  const store = useAcpStore.getState()
  const message = newestAgentMessage(store.messages[sessionId] ?? [])
  if (!message || alreadyShowsPicture(message)) return

  const block = imageBlockFromDataUrl(image)
  if (!block) return

  store.appendBlockToMessage(sessionId, message.id, block)
}
