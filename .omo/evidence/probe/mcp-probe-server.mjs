#!/usr/bin/env node
/**
 * Probe MCP server — stdio, JSON-RPC 2.0, newline-delimited. Dependency-free.
 *
 * Purpose: expose exactly two tools with deliberately long descriptions so the
 * deferred-tool-description size crosses the `ENABLE_TOOL_SEARCH` threshold
 * decoded in `.omo/roblox-re/06-root-cause-verdict.md` (default 10% of the
 * context window), which is what makes Claude Code defer MCP tool schemas.
 *
 * Env:
 *   PROBE_DESC_CHARS  target description length per tool (default 60000)
 *   PROBE_LOG         optional file to append diagnostics to (stderr is always used)
 *   PROBE_CALL_LOG    optional file to append one line per tools/call
 *
 * Nothing here touches Roblox, Studio, or any Termul state.
 */

import { appendFileSync } from 'node:fs'

const DESC_CHARS = Math.max(200, Number(process.env.PROBE_DESC_CHARS || '60000'))
const INIT_DELAY_MS = Math.max(0, Number(process.env.PROBE_INIT_DELAY_MS || '0'))
const LOG_PATH = process.env.PROBE_LOG || ''
const CALL_LOG = process.env.PROBE_CALL_LOG || ''

function log(...parts) {
  const line = `[probe-mcp] ${parts.join(' ')}`
  try {
    process.stderr.write(`${line}\n`)
  } catch {}
  if (LOG_PATH) {
    try {
      appendFileSync(LOG_PATH, `${line}\n`)
    } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic, realistic-looking padding prose                      */
/* ------------------------------------------------------------------ */

const SUBJECTS = [
  'the active DataModel',
  'the Workspace service',
  'the selected Instance subtree',
  'the replication container',
  'the scripting environment',
  'the asset manifest',
  'the instance attribute table',
  'the physics assembly group'
]

const ACTIONS = [
  'enumerates every descendant that satisfies the supplied predicate',
  'resolves the effective property value after inheritance and overrides',
  'reconciles the cached snapshot against the live authoritative state',
  'projects the subtree into a compact structural outline',
  'validates the candidate payload against the current schema revision',
  'records the before/after delta for later replay',
  'walks the parent chain to compute the fully qualified path',
  'normalizes numeric identifiers before comparison'
]

const QUALIFIERS = [
  'Traversal is breadth-first and yields once per batch so the host stays responsive',
  'Results are ordered by depth then by stable creation index, never by hash order',
  'Identifiers are treated as opaque strings and are never coerced to numbers',
  'The response is bounded; when the bound is hit the payload reports truncation explicitly',
  'No mutation occurs unless the caller opts in through the write flag',
  'Concurrency is not assumed: callers must serialize writes to the same subtree',
  'Failures are reported as structured errors rather than partial success',
  'The operation is idempotent for identical inputs within one session'
]

const CAVEATS = [
  'Callers should prefer the narrowest selector available to avoid scanning unrelated branches',
  'Large subtrees may exceed the response budget, in which case narrow the selector and retry',
  'Property values that are computed at runtime are reported as unresolved rather than guessed',
  'Instances created after the snapshot was taken are not visible to this call',
  'Permission-denied children are skipped and counted, not raised as errors',
  'The ordering guarantee applies only within a single response, not across calls'
]

function buildDescription(toolName) {
  const head =
    `Tool \`${toolName}\`: inspects and reports structured state from a live authoring host. ` +
    `This tool is read-only unless explicitly stated otherwise and never mutates the target ` +
    `document as a side effect of inspection.\n\n`

  const chunks = []
  let total = head.length
  let i = 0
  while (total < DESC_CHARS) {
    const s = SUBJECTS[i % SUBJECTS.length]
    const a = ACTIONS[(i * 3 + 1) % ACTIONS.length]
    const q = QUALIFIERS[(i * 5 + 2) % QUALIFIERS.length]
    const c = CAVEATS[(i * 7 + 3) % CAVEATS.length]
    const para =
      `Section ${i + 1}. When invoked, this tool ${a} for ${s}. ${q}. ${c}. ` +
      `This behaviour is stable across calls within one session and does not depend on ` +
      `the order in which earlier tools were invoked.\n\n`
    chunks.push(para)
    total += para.length
    i += 1
  }
  return head + chunks.join('')
}

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

function makeTool(name, summary) {
  return {
    name,
    description: `${buildDescription(name)}\nSummary: ${summary}\n`,
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional selector narrowing the inspected scope.'
        }
      },
      required: [],
      additionalProperties: false
    }
  }
}

const TOOLS = [
  makeTool('probe_alpha_tool', 'Alpha probe tool used to measure tool-schema deferral.'),
  makeTool('probe_beta_tool', 'Beta probe tool used to measure tool-schema deferral.')
]

// Optional bulk tools. Claude Code truncates each description at ~4096 chars,
// so crossing the 10%-of-context deferral threshold needs MANY tools, not one
// huge one. These exist only to push the deferred-tool total over the line so
// `auto:N` mode reproduces the production condition (auto_above_threshold).
const BULK = Math.max(0, Number(process.env.PROBE_BULK_TOOLS || '0'))
for (let i = 0; i < BULK; i += 1) {
  TOOLS.push(
    makeTool(
      `probe_bulk_${String(i).padStart(3, '0')}`,
      `Bulk filler tool #${i} used only to raise the total deferred-tool size.`
    )
  )
}

log(
  'starting',
  `descCharsTarget=${DESC_CHARS}`,
  `toolCount=${TOOLS.length}`,
  TOOLS.map((t) => `${t.name}=${t.description.length}chars`).join(' ')
)

/* ------------------------------------------------------------------ */
/* JSON-RPC over NDJSON stdio                                          */
/* ------------------------------------------------------------------ */

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handle(msg) {
  const { id, method, params } = msg || {}

  // Notifications carry no id and expect no response.
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized' || method === 'initialized') {
      log('received notifications/initialized')
    } else if (method) {
      log('notification', method)
    }
    return
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion || '2024-11-05'
      log('initialize', `clientProtocolVersion=${requested}`, `delayMs=${INIT_DELAY_MS}`)
      // Emulates a slow-to-handshake upstream (e.g. a cold StudioMCP.exe) so the
      // documented 5s `alwaysLoad` connect block can be measured.
      const respond = () =>
        reply(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: 'probe-mcp-server', version: '1.0.0' }
        })
      if (INIT_DELAY_MS > 0) setTimeout(respond, INIT_DELAY_MS)
      else respond()
      return
    }
    case 'ping': {
      reply(id, {})
      return
    }
    case 'tools/list': {
      log('tools/list', `returning ${TOOLS.length} tools`)
      reply(id, { tools: TOOLS })
      return
    }
    case 'tools/call': {
      const name = params?.name
      log('tools/call', `name=${name}`)
      if (CALL_LOG) {
        try {
          appendFileSync(CALL_LOG, `tools/call ${name}\n`)
        } catch {}
      }
      if (!TOOLS.some((t) => t.name === name)) {
        replyError(id, -32602, `Unknown tool: ${name}`)
        return
      }
      reply(id, {
        content: [{ type: 'text', text: `PROBE_OK:${name}` }],
        isError: false
      })
      return
    }
    case 'resources/list': {
      reply(id, { resources: [] })
      return
    }
    case 'prompts/list': {
      reply(id, { prompts: [] })
      return
    }
    default: {
      log('unhandled method', String(method))
      replyError(id, -32601, `Method not found: ${method}`)
      return
    }
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch (err) {
      log('parse error', String(err))
      continue
    }
    try {
      handle(msg)
    } catch (err) {
      log('handler error', String(err))
      if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(err))
    }
  }
})

process.stdin.on('end', () => {
  log('stdin closed, exiting')
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('SIGTERM')
  process.exit(0)
})
process.on('SIGINT', () => {
  log('SIGINT')
  process.exit(0)
})
