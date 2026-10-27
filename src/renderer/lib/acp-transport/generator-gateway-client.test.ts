import { describe, expect, it, vi } from 'vitest'
import {
  type GeneratorCall,
  GeneratorGatewayClient,
  type GeneratorReply
} from './generator-gateway-client'

const CALL: GeneratorCall = {
  agentId: 'claude',
  sessionId: 's-1',
  callId: 4,
  tool: 'generate_clothing',
  arguments: '{"type":"shirt"}'
}

function harness(options: { live?: boolean } = {}) {
  const sent: Array<[string, unknown]> = []
  const transport = {
    request: vi.fn(async (type: string, payload: unknown) => {
      sent.push([type, payload])
      return { resolved: true }
    }),
    isLive: () => options.live ?? true
  }
  return { client: new GeneratorGatewayClient(transport), transport, sent }
}

describe('GeneratorGatewayClient', () => {
  it('answers with generator_reply carrying the handler result', async () => {
    const { client, sent } = harness()
    const reply: GeneratorReply = { callId: 4, ok: true, result: { taskId: 't-1' } }
    client.setHandler(async () => reply)

    await client.handleCall(CALL)

    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('generator_reply')
    expect(sent[0][1]).toEqual(reply)
  })

  it('refuses when no handler is installed instead of hanging the call', async () => {
    const { client, sent } = harness()

    await client.handleCall(CALL)

    expect(sent[0][1]).toMatchObject({ callId: 4, ok: false })
    expect(String((sent[0][1] as GeneratorReply).error)).toContain('no generator is registered')
  })

  it('turns a throwing handler into a failed reply rather than a rejection', async () => {
    const { client, sent } = harness()
    client.setHandler(() => Promise.reject(new Error('boom')))

    await client.handleCall(CALL)

    expect(sent[0][1]).toMatchObject({ callId: 4, ok: false })
    expect((sent[0][1] as GeneratorReply).error).toContain('boom')
  })

  it('does not answer when the connection went away', async () => {
    const { client, transport } = harness({ live: false })
    client.setHandler(async () => ({ callId: 4, ok: true }))

    await client.handleCall(CALL)

    expect(transport.request).not.toHaveBeenCalled()
  })

  it('survives a reply that fails to send', async () => {
    const { client, transport } = harness()
    transport.request.mockRejectedValueOnce(new Error('socket closed'))
    client.setHandler(async () => ({ callId: 4, ok: true }))

    await expect(client.handleCall(CALL)).resolves.toBeUndefined()
  })
})
