# 13 — STATUS IMPLEMENTASI 1–3

Dikerjakan sesuai keputusan: **stdio**, **registry**, **icon asli**, **UI-only**.

## Yang sudah selesai dan terverifikasi

### Langkah 1 — Tombol "Roblox" di sidebar

| File | Perubahan |
|---|---|
| `src/renderer/components/icons/index.tsx` | `export const Roblox` — SVG 48×48, 2 path, stroke `currentColor`, pola sama dengan `Square` |
| `src/renderer/components/shell/RailExpanded.tsx` | `<RailRow label="Roblox">` tepat setelah Canvas |
| `src/renderer/components/shell/RailCollapsed.tsx` | `<RailButton aria-label="Open Roblox">` setelah Canvas |
| `src/renderer/components/shell/ShellRail.tsx` | props `onOpenRoblox` + `canOpenRoblox`, diteruskan ke dua varian |
| `src/renderer/components/shell/ShellFrame.tsx` | teruskan keduanya; `canOpenRoblox = Boolean(activeProject?.path)` |
| `src/renderer/layouts/WorkspaceLayout.tsx` | teruskan `handleOpenRoblox` ke `ShellFrame` |
| `src/renderer/layouts/workspace-layout/use-tab-openers.ts` | `handleOpenRoblox` — resolve Studio → registry → buka launcher |

**Bukti**: `ShellRail.test.tsx` 41/41 lolos, termasuk 2 test baru:
- tombol Roblox ada **setelah** Canvas (dicek via `compareDocumentPosition`)
- disabled + tooltip "Open a project first" saat tidak ada project

### Langkah 2 — Claude-only (UI)

| File | Perubahan |
|---|---|
| `stores/workspace-store/types.ts` | `robloxMode: boolean` di `WorkspaceState` (bukan `ProjectWorkspace` — state UI, bukan bagian tree) |
| `stores/workspace-store/slices/pane.ts` | `setRobloxMode`; `hideAgentLauncher` **mereset** `robloxMode: false` |
| `stores/workspace-store/index.ts` | initial `robloxMode: false` |
| `stores/workspace-store/selectors.ts` | `setRobloxMode` di selector |
| `components/agents/AgentLauncher.tsx` | filter `supportedAgents` ke `CLAUDE_AGENT_CONFIG_ID` saat `robloxMode` |

**Bukti**: `workspace-store.test.ts` 66/66 lolos, termasuk test baru
"resets robloxMode when the launcher is dismissed" — ini yang mencegah filter bocor
ke Ctrl+T.

### Langkah 3 — Discovery + registry

| File | Perubahan |
|---|---|
| `src-tauri/src/roblox.rs` | **baru** — `find_studio_mcp_in()`, `status()`, command `roblox_studio_path`, 5 unit test |
| `src-tauri/src/lib.rs` | `mod roblox;` + command terdaftar di `generate_handler!` |
| `src/renderer/lib/tauri-roblox.ts` | **baru** — adapter `createRobloxApi().studioPath()`, `isTauriContext()` guard |
| `src/renderer/lib/roblox-studio-mcp.ts` | **baru** — `ensureRobloxStudioMcp()`, `robloxStudioEntry()` |
| `src/renderer/lib/tauri-roblox.test.ts` | **baru** — 3 test |
| `src/renderer/lib/roblox-studio-mcp.test.ts` | **baru** — 6 test |

**Bukti logika Rust**: 5/5 lolos. Karena test binary `termul-manager` tidak bisa
start di mesin ini (`STATUS_ENTRYPOINT_NOT_FOUND` — masalah DLL runtime, terbukti
juga pada modul lama `path_validation`), modul diuji sebagai crate terpisah tanpa
Tauri. Semua 5 kasus lolos:
- override menang bila file ada
- override tidak ada → fallback scan
- `LOCALAPPDATA` kosong → `None`, tidak panic
- folder versi tanpa exe → `None`
- override string kosong → diabaikan

**Bukti di mesin ini**: scan menemukan
`C:\Users\Novella\AppData\Local\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe`

## Hasil verifikasi

| Cek | Hasil |
|---|---|
| `bun run typecheck` | **bersih** (3 config: node, web, test) |
| `bun run lint` | tidak ada error; file baru **nol warning** |
| Test terdampak (6 file) | **144 passed**, 17 skipped |
| `ShellRail.test.tsx` | 41/41 |
| `workspace-store.test.ts` | 66/66 |
| `roblox-studio-mcp.test.ts` | 6/6 |
| `tauri-roblox.test.ts` | 3/3 |
| Rust `roblox.rs` | 5/5 |
| Suite penuh | 10.474 passed, 2 failed |

### Tentang 2 kegagalan di suite penuh

`WorkspaceLayout.test.tsx` dan `ConnectedTerminal.contextmenu.test.tsx` gagal di
suite penuh (paralel, ~18 menit), tapi **lolos saat dijalankan sendiri** dan lolos
dalam grup 6 file. Penyebabnya kontaminasi resource: test yang sama butuh 254 detik
di suite penuh vs 13 detik sendirian.

Diverifikasi dengan `git stash`: tanpa perubahan ini pun `WorkspaceLayout.test.tsx`
lolos sendirian, dan `ConnectedTerminal` juga lolos sendirian **dengan** perubahan
ini. Jadi keduanya bukan regresi dari pekerjaan ini — keduanya flaky di bawah beban.

## Yang belum dikerjakan

| Item | Alasan |
|---|---|
| Studio e2e (agent benar-benar memanggil tool Studio) | butuh Studio terbuka + plugin MCP aktif; manual |
| Empty-state "Claude belum terpasang" | filter sudah jalan; pesan khusus belum ada |
| `roblox_studio_path` di surface web | adapter mengembalikan `{found:false}` di non-Tauri; route server belum ada |

## Catatan untuk sesi berikutnya

- `robloxMode` **wajib** di-reset lewat `hideAgentLauncher`. Sudah diimplementasi
  dan ada test-nya. Jangan pindahkan reset ke tempat lain tanpa memperbarui test.
- Path Studio **tidak boleh** di-cache. `ensureRobloxStudioMcp` resolve setiap
  klik karena folder `version-<hash>` berubah tiap update Roblox.
- Mutasi registry memakai `saveMcpServer` yang sudah terserialisasi
  (`runSerializedMcpRegistryMutation`) + rollback + reprobe. Jangan ganti dengan
  `set()` langsung.
- Icon Roblox adalah trademark; ada komentar satu baris di `index.tsx` sebagai
  pengingat.
