# Task 9 — Full affected test suites, with exact commands

Every command below was run and its real exit code recorded. Two pre-existing
failures elsewhere in the crate are documented separately at the end; they are
unrelated to this work and were proven to fail on a clean tree.

## Affected suites

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `cd src-tauri && cargo check --lib --bins` | **0** | `Finished dev profile ... in 41.33s` |
| 2 | `cd src-tauri && cargo clippy --lib --bins -- -D warnings` | **0** | `Finished dev profile ... in 1m 18s` |
| 3 | `cd src-tauri && cargo test --lib roblox` | **0** | `67 passed; 0 failed; 1 ignored; 3368 filtered out` |
| 4 | `cd src-tauri && cargo test --lib acp::manager` | **0** | `167 passed; 0 failed; 0 ignored; 3270 filtered out; 18.86s` |
| 5 | `cd src-tauri && cargo test --lib host_mcp` | **0** | `180 passed; 0 failed; 1 ignored; 3255 filtered out; 9.74s` |
| 6 | `cd src-tauri && cargo test --lib web::ws` | **0** | `325 passed; 0 failed; 0 ignored; 3111 filtered out; 12.50s` |
| 7 | `bun run typecheck` | **0** | `tsc --noEmit` × 3 projects (node / web / test), all clean |
| 8 | `bun run test --run src/renderer/lib/roblox-studio-mcp.test.ts src/renderer/lib/tauri-roblox.test.ts src/renderer/components/RobloxStudioIndicator.test.tsx` | **0** | `Test Files 3 passed (3)` · `Tests 29 passed (29)` · 287.73s |

## Sibling test files

Every new module has a sibling `*_tests.rs` wired with `#[cfg(test)] #[path = "..."]
mod tests;` — no inline `mod tests` tails in production files:

| Module | Sibling | Wiring |
| --- | --- | --- |
| `acp/host_mcp/roblox/instructions.rs` | `instructions_tests.rs` | `roblox/mod.rs:8-10` |
| `acp/manager/gates.rs` (+ `mod.rs`, `command_loop.rs`) | `acp/manager/tests.rs` | pre-existing sibling module, extended |
| `web/ws/projects.rs` (+ `lifecycle.rs`, `dispatch.rs`) | `web/ws/tests.rs` | pre-existing sibling module, extended |

## Real-binary tests are gated

`resolve_place_name_never_fails_without_studio` spawns a real `StudioMCP.exe`, so it
carries `#[ignore = "spawns the real StudioMCP.exe; needs Studio open, so it is not
part of the default suite"]`. It is the only ignored test this work added, and it is
counted in the `1 ignored` above.

Run it explicitly (with Studio open) via:
`cargo test --lib host_mcp::roblox -- --ignored`

## Diff size

```
git status --porcelain -- src-tauri  ->  10 entries
```

10 files, far under the plan's 50-file ceiling. Of these, 9 are modified and 1 is the
new `acp/host_mcp/roblox/` directory (3 files).

## Pre-existing failures, unrelated to this work

`cargo test --lib` (the whole crate) has **2 failures in modules this work never
touched**:

| Test | Failure |
| --- | --- |
| `acp::claude_accounts::tests::links_never_replace_a_real_entry` | `assertion left == right failed` — `left: 9, right: 1` (symlink count) |
| `acp::destructive_guard::tests::a_session_in_a_nested_linked_worktree_does_not_block_the_enclosing_tree` | panic at `destructive_guard/tests.rs:221` |

**Proof they are pre-existing, not caused here:** `git status` shows zero changes to
`claude_accounts` or `destructive_guard` (`git diff --name-only | grep -c
'claude_accounts|destructive_guard'` → `0`). Both were then re-run with this work
stashed (`git stash push -u -- src-tauri`) on the clean tree and **failed identically**
(`left: 9, right: 1`; same panic line). The stash was popped and all 10 files restored.

Both are filesystem/symlink-environment tests. They are not in the affected-module set
above, and todos 1-8 did not change them.

## Honest note on scope

The plan asked for "the full affected test suites", and that is what rows 1-8 are. A
whole-crate `cargo test --lib` was also attempted; it surfaced the two unrelated
failures above. Nothing in the affected modules fails.