#!/usr/bin/env node
/**
 * Matrix runner for the tool-deferral probe.
 *
 * Creates a FRESH throwaway cwd per run (isolating the Claude Code transcript),
 * runs the ACP driver, then reads the transcript and extracts the evidence.
 *
 * Usage:
 *   node run-matrix.mjs --runs a_on,a_off        # subset, or --runs all
 *   node run-matrix.mjs --runs b_100,b_auto      # mechanism B
 *
 * Outputs, per run, into <outDir>/<runId>/:
 *   config.json request.json result.json acp.ndjson adapter-stderr.log
 *   session.json analysis.json transcript.jsonl (copy)
 */

import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/* --------------------------------- setup -------------------------------- */

const ADAPTER_INDEX =
  'C:\\Users\\Novella\\AppData\\Roaming\\com.termul-manager.app\\acp-registry-binaries\\claude-acp\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js'
const PROBE_SERVER = resolve(
  'C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\mcp-probe-server.mjs'
)
const DRIVER = resolve(
  'C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\acp-driver.mjs'
)
const OUT_ROOT = resolve(
  'C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\runs'
)

const PROBE_NAME = 'probe-srv'
const PROBE_DESC_CHARS = process.env.PROBE_DESC_CHARS || '60000'
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || '180000')
const PROMPT = 'Reply with the single word READY.'

/**
 * The channel marker for task 2. Distinctive, greppable, and present nowhere
 * else in the environment — so finding it in the request proves it came from
 * `_meta.systemPrompt.append`, and NOT finding it in `sp_none` proves it is
 * not ambient (settings.json, a project instruction file, or an SDK default).
 */
const MARKER = 'ROBLOX_CHANNEL_PROBE_7f3a9c'
const APPEND_TEXT =
  `${MARKER}: When the Roblox Studio tools are available (probe_alpha_tool, probe_beta_tool), ` +
  `prefer calling them over writing .lua files. This sentence exists only to prove the ` +
  `_meta.systemPrompt.append channel reaches the model-facing system prompt.`

/** The bare-string replacement probe (diagnostic only — never ship this). */
const STRING_PROMPT = `${MARKER}: You are a minimal replacement system prompt. Reply with the single word READY.`

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}
const args = parseArgs(process.argv.slice(2))

/**
 * Run definitions.
 *
 * A′ (the mechanism under test): probe server ONLY in
 * `_meta.claudeCode.options.mcpServers`; ACP `mcpServers` array EMPTY.
 * This is required by 09 Fact 4 — sending it in both places lets the
 * array (projected to 4 fields) overwrite the _meta entry.
 *
 * B (fallback): probe server ONLY in the ACP array, deferral threshold
 * raised through `_meta.claudeCode.options.env.ENABLE_TOOL_SEARCH`.
 */
const RUNS = {
  a_on: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    label: "A' alwaysLoad:true (probe server in _meta only, ACP array empty)"
  },
  a_off: {
    placement: 'meta',
    alwaysLoad: false,
    enableToolSearch: null,
    label: "A' control alwaysLoad:false (probe server in _meta only, ACP array empty)"
  },
  a_absent: {
    placement: 'meta',
    alwaysLoad: null,
    enableToolSearch: null,
    label: "A' control, alwaysLoad key omitted entirely (probe server in _meta only)"
  },
  a_array_on: {
    placement: 'array',
    alwaysLoad: true,
    enableToolSearch: null,
    label:
      'ORDERING-TRAP / Fact-1 probe: alwaysLoad:true on the ACP ARRAY entry only (adapter projects it to 4 fields)'
  },
  a_both_on: {
    placement: 'both',
    alwaysLoad: true,
    enableToolSearch: null,
    label:
      'ORDERING-TRAP demonstration: alwaysLoad:true in BOTH places (array spread last must win => deferral expected)'
  },
  b_100: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: '100',
    label:
      'B ENABLE_TOOL_SEARCH=100 � BARE NUMBER, as 06/09 proposed (probe server in ACP array only)'
  },
  t_on: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    bulkTools: 14,
    label:
      'THRESHOLD-MODE A-prime: 14 bulk tools push deferral above threshold; probe tools carry alwaysLoad:true via _meta'
  },
  t_off: {
    placement: 'meta',
    alwaysLoad: false,
    enableToolSearch: null,
    bulkTools: 14,
    label:
      'THRESHOLD-MODE control: identical bulk load, alwaysLoad:false — deferral MUST engage here'
  },
  cap_a_on: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    captureCmdline: true,
    label: 'CMDLINE CAPTURE for a_on (own fresh cwd; purpose is only to read --mcp-config)'
  },
  cap_t_array_on: {
    placement: 'array',
    alwaysLoad: true,
    enableToolSearch: null,
    bulkTools: 14,
    captureCmdline: true,
    label: 'CMDLINE CAPTURE for t_array_on (ordering trap: alwaysLoad on the ACP array entry)'
  },
  cap_t_both_on: {
    placement: 'both',
    alwaysLoad: true,
    enableToolSearch: null,
    bulkTools: 14,
    captureCmdline: true,
    label: 'CMDLINE CAPTURE for t_both_on (ordering trap: both placements)'
  },
  t_array_on: {
    placement: 'array',
    alwaysLoad: true,
    enableToolSearch: null,
    bulkTools: 14,
    label:
      'THRESHOLD-MODE ordering-trap: alwaysLoad:true on the ACP array entry only, above threshold'
  },
  t_both_on: {
    placement: 'both',
    alwaysLoad: true,
    enableToolSearch: null,
    bulkTools: 14,
    label: 'THRESHOLD-MODE ordering-trap: alwaysLoad:true in BOTH places, above threshold'
  },
  t_b_auto100: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: 'auto:100',
    bulkTools: 14,
    label: 'THRESHOLD-MODE B: ENABLE_TOOL_SEARCH=auto:100 with bulk load above threshold'
  },
  b_array_noenv: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: null,
    label: 'ISOLATION: probe server in ACP array, NO ENABLE_TOOL_SEARCH env at all (baseline)'
  },
  a_meta_auto: {
    placement: 'meta',
    alwaysLoad: null,
    enableToolSearch: 'auto',
    label:
      'ISOLATION: probe server in _meta only, ENABLE_TOOL_SEARCH=auto (does env alone force eager load?)'
  },
  b_auto_rerun: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: 'auto',
    label: 'B ENABLE_TOOL_SEARCH=auto RERUN (reproducibility check of the b_auto anomaly)'
  },
  b_auto100: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: 'auto:100',
    label: 'B ENABLE_TOOL_SEARCH=auto:100 � the CLI-accepted syntax (threshold at 100% of context)'
  },
  b_false: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: 'false',
    label: 'B ENABLE_TOOL_SEARCH=false � deferral off entirely (maximum-robustness control)'
  },
  b_auto: {
    placement: 'array',
    alwaysLoad: null,
    enableToolSearch: 'auto',
    label: 'B control ENABLE_TOOL_SEARCH=auto (probe server in ACP array only)'
  },
  a_on_slow: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    initDelayMs: 9000,
    label:
      "A' with a 9s-slow MCP handshake (exceeds the documented 5s alwaysLoad connect cap) — does the block hold?"
  },
  call_on: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    permissionPolicy: 'allow',
    prompt2:
      'Call the tool mcp__probe-srv__probe_alpha_tool exactly once with no arguments, then reply with its exact text output and nothing else.',
    label:
      "CALLABILITY under A': turn 2 asks the model to invoke the probe tool (permissions allowed)"
  },
  call_off: {
    placement: 'meta',
    alwaysLoad: false,
    enableToolSearch: null,
    permissionPolicy: 'allow',
    prompt2:
      'Call the tool mcp__probe-srv__probe_alpha_tool exactly once with no arguments, then reply with its exact text output and nothing else.',
    label: 'CALLABILITY control: same turn-2 request with alwaysLoad:false (schema deferred)'
  },

  /* ---------------- task 2: the `_meta.systemPrompt` channel ---------------- */
  /* All three mirror the real planned combination: Mechanism A' (alwaysLoad on
   * the _meta mcpServers entry, server omitted from the ACP array) PLUS
   * `claudeCode.options.thinking`, so coexistence is proven, not assumed. */

  sp_append: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    systemPrompt: { append: APPEND_TEXT },
    label:
      "CHANNEL under test: _meta.systemPrompt OBJECT form {append:<marker>} + A' alwaysLoad:true + thinking (the real planned combination)"
  },
  sp_none: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    systemPrompt: null,
    label:
      'CONTROL: byte-identical _meta but NO systemPrompt key at all — proves the marker is not ambient'
  },
  sp_string: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    systemPrompt: STRING_PROMPT,
    label:
      'DIAGNOSTIC: _meta.systemPrompt as a bare STRING (full replacement) — shows why append is mandatory; never ship'
  },
  sp_append_cap: {
    placement: 'meta',
    alwaysLoad: true,
    enableToolSearch: null,
    systemPrompt: { append: APPEND_TEXT },
    captureCmdline: true,
    label:
      'CMDLINE CAPTURE for sp_append — does the append ride a CLI flag or the SDK initialize options object?'
  },
  sp_append_noload: {
    placement: 'meta',
    alwaysLoad: false,
    enableToolSearch: null,
    systemPrompt: { append: APPEND_TEXT },
    label:
      "ISOLATION for (ii): append present but alwaysLoad:FALSE — does append ALONE suppress deferral, or only A'?"
  }
}

const requested = (args.runs || 'a_on,a_off')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const runIds = requested.includes('all') ? Object.keys(RUNS) : requested
for (const id of runIds) {
  if (!RUNS[id]) {
    console.error(`unknown run: ${id}. known: ${Object.keys(RUNS).join(', ')}`)
    process.exit(2)
  }
}

mkdirSync(OUT_ROOT, { recursive: true })

/* ------------------------- transcript utilities ------------------------- */

/** Slugify a cwd the way Claude Code does: non-alphanumerics become '-'. */
function slugifyCwd(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

function projectsDirFor(cwd) {
  return join(homedir(), '.claude', 'projects', slugifyCwd(cwd))
}

function findTranscripts(cwd) {
  const dir = projectsDirFor(cwd)
  if (!existsSync(dir)) return { dir, files: [] }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
  return { dir, files }
}

function readJsonl(path) {
  const raw = readFileSync(path, 'utf8')
  const out = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      out.push({ __unparseable: t.slice(0, 300) })
    }
  }
  return out
}

/** Does a tool name belong to the probe server? */
function isProbeTool(name) {
  if (typeof name !== 'string') return false
  return name.includes('probe_alpha_tool') || name.includes('probe_beta_tool')
}

/** mtime in ms, imported lazily so the module list stays tidy. */
function requireMtime(path) {
  return statSync(path).mtimeMs
}

/**
 * Read claude.exe command lines (which contain the real --mcp-config JSON).
 * Used to prove whether `alwaysLoad` actually reached the CLI.
 */
function claudeCmdlines() {
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Get-CimInstance Win32_Process -Filter "Name=\'claude.exe\'" |',
    "  Where-Object { $_.CommandLine -match 'mcp-config' } |",
    "  ForEach-Object { 'PID=' + $_.ProcessId; $_.CommandLine; '---END---' }"
  ].join('\n')
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    })
  } catch (e) {
    return `<<powershell failed: ${String(e)}>>`
  }
}

/**
 * Truncate long prompt text with an explicit, machine-readable marker so the
 * evidence file never silently claims to quote more than it does.
 */
function _truncate(text, head = 700, tail = 400) {
  if (typeof text !== 'string') return null
  if (text.length <= head + tail + 40) return text
  const hidden = text.length - head - tail
  return `${text.slice(0, head)}...<truncated ${hidden} chars>...${text.slice(text.length - tail)}`
}

/** Join every text block of a system array into one searchable string. */
function systemText(system) {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return null
  const parts = []
  for (const block of system) {
    if (typeof block?.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Locate the marker inside a system-prompt string and return a window around
 * it, so the evidence can quote the exact context the marker landed in.
 */
function markerContext(text, marker, window = 420) {
  if (typeof text !== 'string' || !marker) return null
  const at = text.indexOf(marker)
  if (at < 0) return null
  const from = Math.max(0, at - window)
  const to = Math.min(text.length, at + marker.length + window)
  return {
    charOffset: at,
    totalChars: text.length,
    excerpt: `${from > 0 ? `...<truncated ${from} chars>...` : ''}${text.slice(from, to)}${
      to < text.length ? `...<truncated ${text.length - to} chars>...` : ''
    }`
  }
}

function analyzeTranscript(entries, _probeName, marker) {
  const result = {
    entryCount: entries.length,
    sessionIds: [],
    deferredDelta: null,
    deferredRecords: [],
    reminders: [],
    apiRequestShapes: [],
    systemPromptEvidence: null,
    thresholdLines: [],
    probeToolSeenAnywhere: []
  }

  const sid = new Set()
  for (const e of entries) {
    if (e?.sessionId) sid.add(e.sessionId)
  }
  result.sessionIds = [...sid]

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    const lineNo = i + 1

    if (e?.type === 'attachment' && e?.attachment?.type === 'deferred_tools_delta') {
      const names = Array.isArray(e.attachment.addedNames) ? e.attachment.addedNames : []
      const probeNames = names.filter(isProbeTool)
      result.deferredDelta = {
        lineNo,
        addedNamesCount: names.length,
        addedNames: names,
        probeNamesInAddedNames: probeNames,
        wireHiddenNames: e.attachment.wireHiddenNames ?? null,
        removedNames: e.attachment.removedNames ?? null,
        readdedNames: e.attachment.readdedNames ?? null,
        pendingMcpServers: e.attachment.pendingMcpServers ?? null,
        failedMcpServers: e.attachment.failedMcpServers ?? null,
        needsAuthMcpServers: e.attachment.needsAuthMcpServers ?? null,
        rendered: e.rendered ?? null,
        rawLine: JSON.stringify(e)
      }
    }

    if (e?.type === 'attachment' && e?.attachment?.type === 'deferred_tools_record') {
      const recs = Array.isArray(e.attachment.entries) ? e.attachment.entries : []
      const probe = recs.filter((r) => isProbeTool(r?.name))
      result.deferredRecords.push({
        lineNo,
        totalEntries: recs.length,
        probeEntries: probe.map((r) => ({
          name: r.name,
          defer_loading: r.defer_loading,
          descriptionChars: typeof r.description === 'string' ? r.description.length : null
        }))
      })
    }

    if (e?.type === 'api-request-shape' && e?.shape?.tools) {
      const tools = e.shape.tools
      const probe = tools.filter((t) => isProbeTool(t?.name))
      result.apiRequestShapes.push({
        lineNo,
        toolCount: tools.length,
        toolNames: tools.map((t) => t?.name),
        probeTools: probe.map((t) => ({
          name: t.name,
          hasInputSchema: t.input_schema !== undefined && t.input_schema !== null,
          descriptionChars: typeof t.description === 'string' ? t.description.length : null
        })),
        rawShape: JSON.stringify({ type: e.type, shape: { tools } })
      })

      /*
       * THE CHANNEL EVIDENCE.
       *
       * `api-request-shape.shape.system` is the CLI's own record of
       * `params.system` for the request it actually sent: the writer builds it
       * as `e.params.system.filter(b => !b.text.startsWith("x-anthropic-billing-header:"))`
       * (claude.exe 2.1.309), i.e. the model-facing system prompt minus a
       * billing header block. It is not a summary and not a truncated view:
       * an over-cap shape is REFUSED (`shape_too_large`), never clipped.
       */
      const shapeSystem = e.shape.system
      const joined = systemText(shapeSystem)
      const ctx = markerContext(joined, marker)

      // Record the FIRST shape's system prompt only; later shapes are
      // post-ToolSearch requests and would just repeat the same prompt.
      if (result.systemPromptEvidence === null) {
        const blocks = Array.isArray(shapeSystem)
          ? shapeSystem.map((b, i) => ({
              index: i,
              type: b?.type ?? null,
              textChars: typeof b?.text === 'string' ? b.text.length : null,
              startsWith: typeof b?.text === 'string' ? b.text.slice(0, 120) : null,
              // Per-block marker hit, so the evidence can say WHICH block carries it.
              containsMarker: typeof b?.text === 'string' ? b.text.includes(marker) : false
            }))
          : []

        result.systemPromptEvidence = {
          source: 'api-request-shape.shape.system',
          lineNo,
          systemKind:
            typeof shapeSystem === 'string'
              ? 'string'
              : Array.isArray(shapeSystem)
                ? 'array'
                : typeof shapeSystem,
          blockCount: Array.isArray(shapeSystem) ? shapeSystem.length : null,
          totalChars: typeof joined === 'string' ? joined.length : null,
          marker,
          markerFound: ctx !== null,
          markerContext: ctx,
          blocks,
          // Full joined text kept for local diffing; the evidence file quotes
          // the truncated excerpt instead.
          joinedTextPath: null,
          joinedTextChars: typeof joined === 'string' ? joined.length : null
        }
      }
    }

    // Any rendered text mentioning the deferral reminder.
    const rendered = e?.rendered
    if (Array.isArray(rendered)) {
      for (const r of rendered) {
        const text =
          typeof r?.text === 'string' ? r.text : typeof r?.content === 'string' ? r.content : ''
        if (text && /deferred tools are now available|schemas are NOT loaded/i.test(text)) {
          result.reminders.push({ lineNo, text })
        }
      }
    }
  }

  return result
}

/* --------------------------------- runner -------------------------------- */

function runOne(runId, def) {
  const outDir = join(OUT_ROOT, runId)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // FRESH cwd per run: isolates the Claude Code transcript (stale_state guard).
  const cwd = join(tmpdir(), `probe-${runId}-${randomUUID()}`)
  mkdirSync(cwd, { recursive: true })

  const cfg = {
    runId,
    adapterIndex: ADAPTER_INDEX,
    cwd,
    probeName: PROBE_NAME,
    probeCommand: process.execPath,
    probeArgs: [PROBE_SERVER],
    probeEnv: {
      PROBE_DESC_CHARS,
      PROBE_LOG: join(outDir, 'probe-server.log'),
      PROBE_CALL_LOG: join(outDir, 'probe-calls.log'),
      ...(def.initDelayMs ? { PROBE_INIT_DELAY_MS: String(def.initDelayMs) } : {}),
      ...(def.bulkTools ? { PROBE_BULK_TOOLS: String(def.bulkTools) } : {})
    },
    placement: def.placement,
    alwaysLoad: def.alwaysLoad,
    enableToolSearch: def.enableToolSearch,
    systemPrompt: def.systemPrompt === undefined ? null : def.systemPrompt,
    prompt: PROMPT,
    prompt2: def.prompt2 || null,
    permissionPolicy: def.permissionPolicy || 'deny',
    logPath: join(outDir, 'acp.ndjson'),
    stderrPath: join(outDir, 'adapter-stderr.log'),
    requestPath: join(outDir, 'request.json'),
    resultPath: join(outDir, 'result.json'),
    sessionPath: join(outDir, 'session.json'),
    timeoutMs: TIMEOUT_MS,
    adapterEnv: { CLAUDE_AGENT_LOGS: outDir }
  }
  const cfgPath = join(outDir, 'config.json')
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)

  console.log(`\n=== ${runId} — ${def.label} ===`)
  console.log(`cwd: ${cwd}`)

  // Optional: poll the process table for the claude.exe command line while the
  // session is alive, so the REAL --mcp-config can be quoted as evidence.
  let capTimer = null
  const capOut = join(outDir, 'claude-cmdline.json')
  if (def.captureCmdline) {
    let best = ''
    let polls = 0
    capTimer = setInterval(() => {
      polls += 1
      const txt = claudeCmdlines()
      if (txt.includes('probe-srv')) best = txt
      else if (!best && txt.trim()) best = txt
      writeFileSync(
        capOut,
        `${JSON.stringify({ polls, capturedAt: new Date().toISOString(), raw: best }, null, 2)}\n`
      )
    }, 900)
  }

  const started = Date.now()
  const res = spawn(process.execPath, [DRIVER, '--config', cfgPath], {
    stdio: 'inherit',
    windowsHide: true
  })

  return new Promise((resolveRun) => {
    const killTimer = setTimeout(() => {
      console.error(`[runner] hard timeout on ${runId}, killing driver`)
      try {
        res.kill()
      } catch {}
    }, TIMEOUT_MS + 30000)

    res.on('exit', (code, signal) => {
      clearTimeout(killTimer)
      if (capTimer) clearInterval(capTimer)
      const wallMs = Date.now() - started
      console.log(`[runner] ${runId} exit=${code} signal=${signal} wallMs=${wallMs}`)

      // Read back the driver result if it wrote one.
      let driverResult = null
      try {
        driverResult = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'))
      } catch {}

      // Locate the transcript for THIS run's fresh cwd.
      const { dir: projDir, files } = findTranscripts(cwd)
      let transcriptPath = null
      let analysis = null
      let transcriptCopy = null

      if (files.length > 0) {
        // The cwd is fresh per run, so its project dir should hold exactly one
        // transcript. If several exist, pick the most recently modified and
        // record the count so a stale-state problem is visible, not hidden.
        const withMtime = files.map((f) => {
          let mtime = 0
          try {
            mtime = requireMtime(f)
          } catch {}
          return { f, mtime }
        })
        withMtime.sort((a, b) => b.mtime - a.mtime)
        transcriptPath = withMtime[0].f
        const entries = readJsonl(transcriptPath)
        analysis = analyzeTranscript(entries, PROBE_NAME, MARKER)
        transcriptCopy = join(outDir, 'transcript.jsonl')
        try {
          copyFileSync(transcriptPath, transcriptCopy)
        } catch {}

        /*
         * Persist the FULL model-facing system prompt for this run, so the
         * evidence can be audited locally without trusting a summary. This is
         * the primary artifact for the task-2 channel verdict.
         */
        try {
          const firstShape = entries.find(
            (x) => x?.type === 'api-request-shape' && x?.shape?.system !== undefined
          )
          if (firstShape) {
            const txt = systemText(firstShape.shape.system) ?? ''
            writeFileSync(join(outDir, 'system-prompt.txt'), `${txt}\n`)
            analysis.systemPromptEvidence.joinedTextPath = join(outDir, 'system-prompt.txt')
          }
        } catch {}
      }

      const summary = {
        runId,
        label: def.label,
        placement: def.placement,
        alwaysLoad: def.alwaysLoad,
        enableToolSearch: def.enableToolSearch,
        systemPromptForm:
          def.systemPrompt === undefined || def.systemPrompt === null
            ? 'absent'
            : typeof def.systemPrompt === 'string'
              ? 'string'
              : 'object',
        cwd,
        exitCode: code,
        signal,
        wallMs,
        driverResult,
        projectsDir: projDir,
        transcriptPath,
        transcriptCopiedTo: transcriptCopy,
        transcriptFound: files.length,
        analysis
      }
      writeFileSync(join(outDir, 'analysis.json'), `${JSON.stringify(summary, null, 2)}\n`)

      // Print a compact verdict-relevant summary.
      if (analysis) {
        const d = analysis.deferredDelta
        const probeInDelta = d ? d.probeNamesInAddedNames : null
        console.log(`  sessionIds: ${JSON.stringify(analysis.sessionIds)}`)
        console.log(
          `  deferred_tools_delta: ${d ? `addedNames=${d.addedNamesCount}, probe=${JSON.stringify(probeInDelta)}` : 'ABSENT'}`
        )
        const shape = analysis.apiRequestShapes[0]
        if (shape) {
          console.log(
            `  first api-request-shape: toolCount=${shape.toolCount}, probeTools=${JSON.stringify(shape.probeTools)}`
          )
        } else {
          console.log(`  api-request-shape: ABSENT`)
        }
        console.log(`  deferral reminder present: ${analysis.reminders.length > 0}`)
        console.log(`  failedMcpServers: ${JSON.stringify(d?.failedMcpServers ?? null)}`)

        const spe = analysis.systemPromptEvidence
        if (spe) {
          console.log(
            `  SYSTEM PROMPT [${spe.source}] kind=${spe.systemKind} blocks=${spe.blockCount} chars=${spe.totalChars}`
          )
          console.log(
            `    marker "${MARKER}" found: ${spe.markerFound}${spe.markerContext ? ` @ char ${spe.markerContext.charOffset}` : ''}`
          )
          console.log(
            `    per-block containsMarker: ${JSON.stringify(spe.blocks.map((b) => b.containsMarker))}`
          )
        } else {
          console.log(`  SYSTEM PROMPT: NO api-request-shape with a system field`)
        }
      } else {
        console.log(`  NO TRANSCRIPT FOUND under ${projDir}`)
      }

      resolveRun(summary)
    })
  })
}

/* ---------------------------------- main --------------------------------- */

const results = []
for (const runId of runIds) {
  results.push(await runOne(runId, RUNS[runId]))
}

writeFileSync(join(OUT_ROOT, 'matrix-summary.json'), `${JSON.stringify(results, null, 2)}\n`)
console.log(`\nwrote ${join(OUT_ROOT, 'matrix-summary.json')}`)
