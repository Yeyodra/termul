#!/usr/bin/env node
/**
 * ACP driver for the tool-deferral probe.
 *
 * Spawns the installed claude-agent-acp adapter over stdio (ACP v1, NDJSON),
 * opens a session with a caller-specified placement of the probe MCP server,
 * sends one trivial prompt, drains until the turn ends, then shuts down.
 *
 * Usage:
 *   node acp-driver.mjs --config <run-config.json>
 *
 * Run config fields:
 *   runId            string  — label for logs
 *   adapterIndex     string  — absolute path to dist/index.js
 *   cwd              string  — session working directory (fresh per run)
 *   probeName        string  — MCP server name, e.g. "probe-srv"
 *   probeCommand     string  — absolute path to node
 *   probeArgs        string[]— absolute path to mcp-probe-server.mjs
 *   probeEnv         object  — env for the probe server
 *   placement        "meta" | "array" | "both"   — LOAD-BEARING; see 09 Fact 4
 *   alwaysLoad       boolean|null — value on the _meta / array entry
 *   enableToolSearch string|null — value for ENABLE_TOOL_SEARCH in _meta env
 *   systemPrompt     object|string|null — `_meta.systemPrompt`.
 *                    null  -> key omitted entirely (control)
 *                    {}    -> object form, e.g. { append: "<text>" }
 *                    "..." -> bare string form (full replacement; diagnostic only)
 *   prompt           string
 *   logPath          string  — NDJSON of every ACP message both directions
 *   stderrPath       string  — adapter stderr
 *   timeoutMs        number
 *
 * Exit code 0 means the ACP turn completed (stopReason observed). It does NOT
 * mean the probe succeeded — always assert on the transcript, never on this code.
 */

import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/* ----------------------------- arg parsing ----------------------------- */

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!args.config) {
  console.error('usage: node acp-driver.mjs --config <run-config.json>')
  process.exit(2)
}

const { readFileSync } = await import('node:fs')
const cfg = JSON.parse(readFileSync(args.config, 'utf8'))

const TIMEOUT_MS = Number(cfg.timeoutMs ?? 180000)
const PROMPT = cfg.prompt ?? 'Reply with the single word READY.'
const PLACEMENT = cfg.placement ?? 'meta'
if (!['meta', 'array', 'both'].includes(PLACEMENT)) {
  console.error(`bad placement: ${PLACEMENT}`)
  process.exit(2)
}

mkdirSync(dirname(cfg.logPath), { recursive: true })
const logStream = createWriteStream(cfg.logPath, { flags: 'w' })
const errStream = createWriteStream(cfg.stderrPath, { flags: 'w' })

function record(dir, msg) {
  logStream.write(`${JSON.stringify({ dir, t: new Date().toISOString(), msg })}\n`)
}
function note(text) {
  record('driver', { note: text })
  console.error(`[driver] ${text}`)
}

/* --------------------------- JSON-RPC plumbing -------------------------- */

let nextId = 1
const pending = new Map()

function sendRaw(obj) {
  const line = JSON.stringify(obj)
  record('out', obj)
  proc.stdin.write(`${line}\n`)
}

function request(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method })
    sendRaw({ jsonrpc: '2.0', id, method, params })
  })
}

function _notify(method, params) {
  sendRaw({ jsonrpc: '2.0', method, params })
}

function respond(id, result) {
  sendRaw({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message) {
  sendRaw({ jsonrpc: '2.0', id, error: { code, message } })
}

/* ------------------------------- the run ------------------------------- */

const startedAt = Date.now()

const proc = spawn(process.execPath, [cfg.adapterIndex], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ...(cfg.adapterEnv || {}) },
  windowsHide: true
})

proc.stderr.on('data', (b) => errStream.write(b))
proc.on('error', (e) => {
  note(`adapter spawn error: ${String(e)}`)
})

let stopReason = null
let _resolveDone
const _done = new Promise((r) => {
  _resolveDone = r
})

/* Build the mcpServers array and/or the _meta entry per `placement`. */

const stdioArrayEntry = {
  name: cfg.probeName,
  command: cfg.probeCommand,
  args: cfg.probeArgs,
  env: Object.entries(cfg.probeEnv || {}).map(([name, value]) => ({ name, value }))
  // NOTE: intentionally NO `type` key. acp-agent.js:8518 only projects stdio
  // entries when `!("type" in server)`; adding type:"stdio" would make the
  // entry fall through both branches and vanish entirely.
}
if (cfg.alwaysLoad !== null && cfg.alwaysLoad !== undefined) {
  stdioArrayEntry.alwaysLoad = cfg.alwaysLoad // proves the array drops it (Fact 1)
}

const metaServerEntry = {
  type: 'stdio',
  command: cfg.probeCommand,
  args: cfg.probeArgs,
  env: cfg.probeEnv || {}
}
if (cfg.alwaysLoad !== null && cfg.alwaysLoad !== undefined) {
  metaServerEntry.alwaysLoad = cfg.alwaysLoad
}

const mcpServersArray = []
if (PLACEMENT === 'array' || PLACEMENT === 'both') mcpServersArray.push(stdioArrayEntry)

const claudeCodeOptions = {
  // Mirror what Termul really sends so the session shape matches production.
  thinking: { type: 'adaptive', display: 'summarized' }
}

if (PLACEMENT === 'meta' || PLACEMENT === 'both') {
  claudeCodeOptions.mcpServers = { [cfg.probeName]: metaServerEntry }
}

if (cfg.enableToolSearch !== null && cfg.enableToolSearch !== undefined) {
  claudeCodeOptions.env = { ENABLE_TOOL_SEARCH: String(cfg.enableToolSearch) }
}

const sessionMeta = { claudeCode: { options: claudeCodeOptions } }

/**
 * `_meta.systemPrompt` — the CHANNEL under test in task 2.
 *
 * The key is only attached when the run actually supplies a value, so the
 * `sp_none` control sends a `_meta` byte-identical to task 1's `a_on`
 * (same `claudeCode.options.thinking`, same alwaysLoad, no systemPrompt).
 */
const hasSystemPrompt = cfg.systemPrompt !== null && cfg.systemPrompt !== undefined
if (hasSystemPrompt) sessionMeta.systemPrompt = cfg.systemPrompt

const sessionNewParams = {
  cwd: cfg.cwd,
  mcpServers: mcpServersArray,
  _meta: sessionMeta
}

/* Write the exact request we are about to send, for the evidence file. */
writeFileSync(
  cfg.requestPath,
  `${JSON.stringify(
    {
      runId: cfg.runId,
      placement: PLACEMENT,
      alwaysLoad: cfg.alwaysLoad,
      enableToolSearch: cfg.enableToolSearch,
      systemPrompt: hasSystemPrompt ? cfg.systemPrompt : null,
      systemPromptForm: !hasSystemPrompt
        ? 'absent'
        : typeof cfg.systemPrompt === 'string'
          ? 'string (FULL REPLACEMENT)'
          : 'object (spread with type/preset locked; append survives)',
      note:
        PLACEMENT === 'meta'
          ? 'probe server carried ONLY in _meta.claudeCode.options.mcpServers; ACP mcpServers array is EMPTY (ordering-trap safe)'
          : PLACEMENT === 'array'
            ? 'probe server carried ONLY in the ACP mcpServers array'
            : 'probe server carried in BOTH places (ordering trap active — expect _meta copy to be overwritten)',
      sessionNewParams
    },
    null,
    2
  )}\n`
)

/* ------------------------------ message pump ---------------------------- */

let buf = ''
proc.stdout.setEncoding('utf8')
proc.stdout.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      record('in-unparseable', { raw: line.slice(0, 500) })
      continue
    }
    record('in', msg)

    // Response to one of our requests.
    if (
      msg.id !== undefined &&
      msg.id !== null &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`))
        else p.resolve(msg.result)
      }
      continue
    }

    // Request FROM the agent to us (client methods). Answer so nothing hangs.
    if (msg.id !== undefined && msg.id !== null && msg.method) {
      switch (msg.method) {
        case 'session/request_permission': {
          // Configurable: "allow" lets a tool call proceed (needed to prove a
          // tool is genuinely callable); "deny" keeps the trivial turn short.
          const opts = Array.isArray(msg.params?.options) ? msg.params.options : []
          if (cfg.permissionPolicy === 'allow') {
            const allow =
              opts.find((o) => o?.kind === 'allow_once') ||
              opts.find((o) => o?.kind === 'allow_always') ||
              opts[0]
            if (allow?.optionId) {
              respond(msg.id, { outcome: { outcome: 'selected', optionId: allow.optionId } })
            } else {
              respond(msg.id, { outcome: { outcome: 'cancelled' } })
            }
          } else {
            respond(msg.id, { outcome: { outcome: 'cancelled' } })
          }
          break
        }
        case 'fs/read_text_file': {
          respondError(msg.id, -32601, 'probe client does not implement fs/read_text_file')
          break
        }
        case 'fs/write_text_file': {
          respondError(msg.id, -32601, 'probe client does not implement fs/write_text_file')
          break
        }
        case 'terminal/create':
        case 'terminal/output':
        case 'terminal/wait_for_exit':
        case 'terminal/kill':
        case 'terminal/release': {
          respondError(msg.id, -32601, `probe client does not implement ${msg.method}`)
          break
        }
        default: {
          respondError(msg.id, -32601, `probe client does not implement ${msg.method}`)
          break
        }
      }
      continue
    }

    // Notification: end-of-turn signal arrives as the session/prompt response,
    // so nothing to do here beyond logging.
    if (msg.method === 'session/update') {
      const u = msg.params?.update
      if (u?.sessionUpdate === 'agent_message_chunk') {
        const t = u?.content?.text
        if (t) note(`agent says: ${String(t).trim().slice(0, 200)}`)
      }
    }
  }
})

/* -------------------------------- sequence ------------------------------ */

const hardTimeout = setTimeout(() => {
  note(`HARD TIMEOUT after ${TIMEOUT_MS}ms — recording as INCONCLUSIVE`)
  finish(null, 'timeout')
}, TIMEOUT_MS)

let finished = false
function finish(reason, status) {
  if (finished) return
  finished = true
  clearTimeout(hardTimeout)
  const summary = {
    runId: cfg.runId,
    placement: PLACEMENT,
    alwaysLoad: cfg.alwaysLoad,
    enableToolSearch: cfg.enableToolSearch,
    systemPromptForm: !hasSystemPrompt
      ? 'absent'
      : typeof cfg.systemPrompt === 'string'
        ? 'string'
        : 'object',
    cwd: cfg.cwd,
    status,
    stopReason: reason,
    wallMs: Date.now() - startedAt
  }
  writeFileSync(cfg.resultPath, `${JSON.stringify(summary, null, 2)}\n`)
  note(`finish status=${status} stopReason=${reason} wallMs=${summary.wallMs}`)
  try {
    proc.stdin.end()
  } catch {}
  try {
    proc.kill()
  } catch {}
  setTimeout(() => {
    try {
      logStream.end()
      errStream.end()
    } catch {}
    process.exit(status === 'completed' ? 0 : 1)
  }, 250)
}

async function main() {
  note(
    `runId=${cfg.runId} placement=${PLACEMENT} alwaysLoad=${cfg.alwaysLoad} ts=${cfg.enableToolSearch}`
  )

  // 1. initialize (ACP v1)
  const initRes = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false
    },
    clientInfo: { name: 'deferral-probe', version: '1.0.0' }
  })
  note(`negotiated protocolVersion=${JSON.stringify(initRes?.protocolVersion)}`)

  // 2. session/new
  const newRes = await request('session/new', sessionNewParams)
  const sessionId = newRes?.sessionId
  note(`sessionId=${sessionId}`)
  writeFileSync(
    cfg.sessionPath,
    `${JSON.stringify({ sessionId, newSessionResponse: newRes }, null, 2)}\n`
  )
  if (!sessionId) throw new Error('session/new returned no sessionId')

  // 3. session/prompt — one trivial turn so turn-1 prompt construction happens.
  const promptRes = await request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: PROMPT }]
  })
  stopReason = promptRes?.stopReason ?? null
  note(`prompt stopReason=${JSON.stringify(stopReason)}`)

  // 3b. optional second turn: ask the model to actually invoke a probe tool.
  // This distinguishes "schema present" from "genuinely callable".
  if (cfg.prompt2) {
    note(`turn 2: ${cfg.prompt2}`)
    const prompt2Res = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: cfg.prompt2 }]
    })
    note(`turn2 stopReason=${JSON.stringify(prompt2Res?.stopReason)}`)
  }

  finish(stopReason, 'completed')
}

main().catch((err) => {
  note(`FATAL: ${String(err)}`)
  finish(null, 'error')
})
