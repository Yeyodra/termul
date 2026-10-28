# Learnings - roblox-tool-loading-v2

## Verified mechanism facts (do not re-derive)

1. A-prime works: `alwaysLoad: true` on `_meta.claudeCode.options.mcpServers["roblox-studio"]`
   suppresses deferral for that server only. Proven with an `alwaysLoad:false` control.
2. The ACP `mcpServers` array silently drops everything but `{type,command,args,env}`
   (`acp-agent.js:8518-8528`). Putting `alwaysLoad` there is a no-op.
3. ORDERING TRAP: the adapter spreads the ACP array AFTER `_meta` (`acp-agent.js:8699-8702`).
   If `roblox-studio` is in BOTH places, the flag is overwritten. The server must be
   removed from the array. Measured: `t_array_on` and `t_both_on` produced --mcp-config
   with ZERO alwaysLoad keys.
4. `ENABLE_TOOL_SEARCH=100` is a silent no-op. Only `auto:N` (or `false`) works.
   `auto:100` = deferral off entirely. Both `06` and `09` proposed the wrong value.
5. `_meta.systemPrompt.append` reaches the model-facing prompt (structural proof).
   It is a CARRIER ONLY - it does not make tools callable.
6. Bare-string `_meta.systemPrompt` destroys the preset prompt: 5774 -> 170 chars,
   losing `# Harness`, `# Memory`, `# Environment`, `# Context management`.
7. Side-effect to expect in tests: any non-empty `append` flips `system[0]` from the
   62-char generic form to the 94-char "You are Claude Code..." form. An append session
   is never byte-identical to a no-append session outside the appended text - allow a
   32-char delta in any "only the append changed" test.

## Architecture facts for implementation

8. There is ONE session-creation path. `DesktopAcpTransport extends WsAcpTransport`
   (`src/renderer/lib/acp-transport/desktop-transport.ts`). There is no Tauri
   `acp_new_session` command in this tree. All session requests go through the WS
   handlers, which DO have `&ProjectRegistry`.
9. `roblox-studio` is attached to EVERY session of EVERY project once registered,
   because `selectMcpServersForAgent` iterates the whole shared registry
   (`acp-mcp-persistence.ts:152`, `session.ts:1540-1543`). Gating on "the entry is
   present" would change non-Roblox sessions - forbidden. Project identity is required.
10. Plumbing already exists: `SessionCreationContext.project_id` and
    `AcpCommand::NewSession.project_id` are threaded today. Extend that pattern; the
    reopen commands (`LoadSession`/`ResumeSession`) need the new field added.

## Process learnings

11. Do not use `Get-Content`/`Set-Content` on the plan file. PowerShell 5.1 round-trips
    UTF-8 as ANSI and double-encodes em-dashes. Use the `edit` tool, or
    `[System.IO.File]::ReadAllText/WriteAllText` with explicit UTF8 encoding.
12. A "deep" worker can return with zero code changes if it hits a genuine design fork
    (todo 4 did exactly this). Resolve the fork in an `.omo/` design note and re-dispatch.
13. The probe harness at `.omo/evidence/probe/` is reusable and proven to drive the real
    adapter end-to-end. Extend it; do not rebuild it.

## Open risks

- Verdicts were measured on the SDK-bundled claude.exe 2.1.309, not the user's
  ~/.local/bin/claude.exe 2.1.296. Do not restate the verdict as "2.1.296 honours alwaysLoad".
- Real Roblox eager-load token cost (~13,919 tokens per `06`) is unmeasured with the real
  28 Studio tools; only a synthetic server was used.