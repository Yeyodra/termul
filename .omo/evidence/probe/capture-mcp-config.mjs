#!/usr/bin/env node
/**
 * Captures the REAL command line (including the --mcp-config JSON) that the ACP
 * adapter hands to claude.exe for a given placement.
 *
 * This answers "did the value reach claude.exe", which is a different question
 * from "did claude.exe act on it". Polls the process table while a probe session
 * is alive, then writes the matching claude.exe command lines to a file.
 *
 * Usage: node capture-mcp-config.mjs --config <run-config.json> --out <file>
 */

import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const cfgPath = args.config
const outPath = args.out
if (!cfgPath || !outPath) {
  console.error('usage: node capture-mcp-config.mjs --config <cfg> --out <file>')
  process.exit(2)
}

const DRIVER =
  'C:\\Users\\Novella\\Documents\\Github\\termul\\.omo\\evidence\\probe\\acp-driver.mjs'

/** Query Win32_Process for claude.exe command lines. */
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

const child = spawn(process.execPath, [DRIVER, '--config', cfgPath], {
  stdio: 'ignore',
  windowsHide: true
})

let best = ''
let polls = 0
const timer = setInterval(() => {
  polls += 1
  const txt = claudeCmdlines()
  // Keep the sample that mentions our probe server name.
  if (txt.includes('probe-srv') || txt.includes('probe_alpha')) best = txt
  else if (!best && txt.trim()) best = txt
}, 900)

child.on('exit', () => {
  clearInterval(timer)
  // One final poll in case the process lingered.
  const txt = claudeCmdlines()
  if (txt.includes('probe-srv') || txt.includes('probe_alpha')) best = txt

  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        polls,
        capturedAt: new Date().toISOString(),
        raw: best || '<<no claude.exe process with --mcp-config observed>>'
      },
      null,
      2
    )}\n`
  )
  console.log(`polls=${polls} wrote ${outPath}`)
  console.log(best ? best.slice(0, 4000) : '(nothing captured)')
})
