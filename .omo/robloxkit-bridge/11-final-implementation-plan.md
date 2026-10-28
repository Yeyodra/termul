# 11 — Rencana implementasi final (keputusan user: stdio, registry, icon asli, UI-only)

Keputusan yang mengikat:

| # | Keputusan | Konsekuensi |
|---|---|---|
| 1 | **stdio** (bukan HTTP) | pakai `McpServer::Stdio`; gate selalu lolos |
| 2 | **registry** (bukan embedded MCP) | nol kode server; pakai registry MCP Termul |
| 3 | **icon Roblox asli** | perlu SVG path; catatan trademark |
| 4 | **UI-only** untuk batasi agent | tidak ada penolakan backend |

## Langkah 1 — Tombol "Roblox" di sidebar

### 1a. Icon

`src/renderer/components/icons/index.tsx` memakai Hugeicons (`:137`), dan
`hugeIcon(name, icon)` (`:151-176`) menghasilkan `TermulIcon`.

Hugeicons **tidak punya** icon Roblox. Jadi tambahkan komponen SVG biasa di file
yang sama, mengikuti bentuk `TermulIcon` (`:145-149`):

```tsx
export const Roblox = forwardRef<SVGSVGElement, TermulIconProps>(function Roblox(
  { size = 24, ...props }, ref
) {
  return (
    <svg ref={ref} width={size} height={size} viewBox="0 0 24 24"
         fill="currentColor" aria-hidden data-termul-icon="Roblox" {...props}>
      {/* Roblox mark: rotated square with the inner square cut out */}
      <path d="…" />
    </svg>
  )
})
```

**Catatan trademark (penting, sudah disetujui user):** logo Roblox adalah merek
dagang Roblox Corporation. Aman untuk pemakaian pribadi. Kalau nanti dipublikasi,
ganti dengan bentuk generik atau text-mark.

### 1b. Rail expanded (sidebar lebar)

`src/renderer/components/shell/RailExpanded.tsx:59-74` — sisipkan setelah Canvas,
sebelum `</div>` di `:74`:

```tsx
<RailRow
  label="Roblox"
  name="Open Roblox"
  hint={canOpenRoblox ? undefined : NEED_PROJECT}
  icon={<Roblox size={16} />}
  disabled={!canOpenRoblox}
  onClick={onOpenRoblox}
/>
```

`RailRow` sudah generik (`RailRow.tsx:7-22`) — tidak perlu komponen baru.

### 1c. Rail collapsed (WAJIB — mudah terlewat)

`src/renderer/components/shell/RailCollapsed.tsx:180-188` punya `RailButton` untuk
Canvas. Tanpa tambahan di sini, tombol Roblox **hilang saat rail diciutkan**.

```tsx
<RailButton label="Open Roblox" aria-label="Open Roblox"
            disabled={!canOpenRoblox} onClick={onOpenRoblox}>
  <Roblox size={16} />
</RailButton>
```

### 1d. Rantai props (verified)

```
WorkspaceModals.tsx:161   onOpenCanvas={handleOpenCanvas}
  └─ ShellFrame.tsx:160   <ShellRail …>
       └─ ShellRail.tsx:90-99 (expanded) / :107-113 (collapsed)
            └─ RailExpanded.tsx:59-74 / RailCollapsed.tsx:180-188
```

Tambahkan `onOpenRoblox` di tiap lapis:
- `ShellRail.tsx:14-26` (interface) + `:99`, `:113` (pass-down)
- `ShellFrame.tsx:160`
- `WorkspaceModals.tsx:67`, `:94`, `:161`

### 1e. Handler

Pola yang sudah ada (`WorkspaceModals.tsx:153-158`):

```tsx
onShowAgentLauncher={() => {
  const paneId = useWorkspaceStore.getState().activePaneId
  if (paneId) useWorkspaceStore.getState().showAgentLauncher(paneId)
}}
```

`showAgentLauncher(paneId)` hanya menyetel `agentLauncherPaneId`
(`stores/workspace-store/slices/pane.ts:48-50`). Jadi "buka chat baru" =
**set `agentLauncherPaneId`**, dan launcher ("What should we do in termul?")
muncul.

`handleOpenRoblox` mengikuti bentuk itu, ditambah penanda Roblox (Langkah 2).

**Acceptance Langkah 1**
- [ ] Tombol "Roblox" muncul tepat di bawah Canvas, expanded rail.
- [ ] Muncul juga di collapsed rail.
- [ ] Klik → launcher chat baru terbuka.
- [ ] Tanpa project → disabled + tooltip "Open a project first" (pola `NEED_PROJECT`, `RailExpanded.tsx:27`).

## Langkah 2 — Claude-only (UI saja)

User memilih **UI-only**: sembunyikan agent lain, tanpa penolakan backend.

Perlu diputuskan bentuknya. Dua pilihan, keduanya UI:

| Opsi | Cara | Catatan |
|---|---|---|
| **2a** | Filter daftar agent di launcher saat dibuka dari Roblox | picker tetap ada, isinya 1 |
| **2b** | Sembunyikan picker, kunci ke Claude | paling dekat ke "hilangin yang lain" |

Rekomendasi: **2b** — lebih sedikit state, dan sesuai permintaan.

Yang belum gw baca (perlu saat implementasi):
- `components/agents/AgentLauncher.tsx` — bagaimana picker mengambil daftar agent
- `components/agents/launcher/toolbar.tsx` — komponen picker-nya
- Bagaimana `createSession(agentId, …)` dipanggil dari launcher
  (`slices/session.ts:1538`)

Id Claude di katalog: `claude-acp` (`src-tauri/src/acp/catalog.rs:954, 1142`).

**Acceptance Langkah 2**
- [ ] Launcher dari tombol Roblox hanya menawarkan Claude.
- [ ] Launcher dari jalur normal (Ctrl+T / command palette) **tetap** semua agent.

Poin kedua itu penting: jangan sampai filter-nya bocor ke alur lain.

## Langkah 3 — Studio MCP masuk session

### 3a. Discovery (Rust, tulis baru)

Termul **nol kode Roblox** — grep `Roblox|StudioMCP|Versions` di
`src-tauri/src/` hanya 2 false positive. Jadi port dari RobloxKit
`app/src-tauri/src/studio.rs:48-74`:

```rust
pub fn find_studio_mcp() -> Option<PathBuf> {
    // 1. env STUDIO_MCP_EXE (override)
    // 2. scan %LOCALAPPDATA%\Roblox\Versions\*\StudioMCP.exe
}
```

**Jangan simpan path-nya** — folder `version-<hash>` berubah tiap update Roblox.
Resolve setiap kali tombol dipakai.

### 3b. Command + registry

```
roblox_studio_path  → { found: bool, path?: string }
```

Lalu renderer menambahkan entry ke registry **lokal mesin ini**:

```json
{ "type": "stdio", "name": "roblox-studio", "command": "<hasil scan>", "args": [], "env": [] }
```

Registry sudah per-mesin (`acp-mcp-persistence.ts:176-189`), jadi tidak perlu
mengubah storage. `args`/`env` wajib ada walau kosong (`:58-66`).

Mutasi registry **wajib** lewat `runSerializedMcpRegistryMutation`
(`slices/mcp.ts:33-38`) — kalau tidak, dua mutasi bersamaan bisa saling menimpa.

### 3c. Aturan yang mengikat command baru

- Parity trio: adapter + export `api.ts` + test file
  (`parity-checklist.test.ts:237-272`)
- Web/`termul-server` harus gagal rapi (host Linux tak punya Roblox)
- `log` + jangan log path berisi username mentah tanpa redaksi

**Acceptance Langkah 3**
- [ ] Studio terpasang → entry muncul di registry, chat Claude melihat tool Studio.
- [ ] Studio tidak terpasang → pesan jelas, tidak crash.
- [ ] Roblox update (hash berubah) → resolve ulang, tetap jalan.
- [ ] Chat non-Roblox tidak terpengaruh.

## Yang TIDAK dikerjakan (sesuai keputusan)

- HTTP MCP server (dipilih stdio). `rmcp` 3.5 di proyek ini bahkan tidak punya
  fitur server-HTTP (`Cargo.toml:132-141`).
- Embedded MCP sendiri / `FrameKind::Roblox` (dipilih registry).
- Penolakan agent di backend (dipilih UI-only).
- Tool non-Studio (generative engines) — itu track terpisah (`06`, `07`, `08`).

## Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Lupa `RailCollapsed` | tombol hilang saat rail diciutkan | masuk acceptance Langkah 1 |
| Filter agent bocor ke alur normal | user kehilangan agent lain | acceptance Langkah 2 poin 2 |
| Path Studio basi setelah update | connect gagal diam-diam | resolve tiap pakai, jangan simpan |
| Icon Roblox = trademark | masalah kalau dipublikasi | sudah disetujui; ganti bila perlu |
| Mutasi registry tanpa serialisasi | entry hilang | pakai `runSerializedMcpRegistryMutation` |
