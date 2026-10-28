/**
 * Puts the rendered picture on the tool card that produced it.
 *
 * The generator runs through the MCP child, so its result reaches the agent, not
 * the transcript: `child.rs` lifts `image` into an image content block for the
 * model, and nothing carries it back to the chat. The renderer holds the bytes
 * already (`readClothingResult` returns them), so it attaches them to the tool
 * call the agent reported.
 *
 * Matched by tool title, because the ACP kind is generic for every generator
 * tool and the name arrives namespaced by the MCP server.
 */

import type { ContentBlock, ToolCall, ToolCallContent } from '@/lib/acp-api'
import { useAcpStore } from '@/stores/acp-store'

function bareName(toolCall: ToolCall): string {
  return (toolCall.title?.trim().toLowerCase() ?? '').replace(/^mcp__[a-z0-9_]+__/, '')
}

function isTaskPoll(toolCall: ToolCall): boolean {
  return bareName(toolCall).startsWith('get_clothing_task')
}

function hasImage(toolCall: ToolCall): boolean {
  return (toolCall.content ?? []).some((item) => {
    if (item.type !== 'content') return false
    const block = (item as { content?: ContentBlock }).content
    return block?.type === 'image'
  })
}

/** `data:image/png;base64,…` into the block shape ACP uses on the wire. */
export function imageBlockFromDataUrl(dataUrl: string): ContentBlock | null {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return null
  const head = dataUrl.slice(0, comma)
  if (!head.startsWith('data:image/')) return null
  const mimeType = head.slice('data:'.length).split(';')[0] || 'image/png'
  return { type: 'image', data: dataUrl.slice(comma + 1), mimeType }
}

/**
 * Attach `image` to the newest settled `get_clothing_task` card of `sessionId`.
 * Does nothing when the card already shows a picture, so a repeated poll does
 * not stack duplicates.
 */
export function attachGeneratedPicture(sessionId: string, image?: string): void {
  if (!image) return
  const store = useAcpStore.getState()
  const calls = store.toolCalls[sessionId] ?? []
  const target = [...calls].reverse().find((call) => isTaskPoll(call) && !hasImage(call))
  if (!target) return

  const block = imageBlockFromDataUrl(image)
  if (!block) return

  const content: ToolCallContent[] = [
    ...(target.content ?? []),
    { type: 'content', content: block }
  ]
  store._onToolCallUpdate({
    agentId: '',
    sessionId,
    update: { toolCallId: target.toolCallId, content }
  })
}
