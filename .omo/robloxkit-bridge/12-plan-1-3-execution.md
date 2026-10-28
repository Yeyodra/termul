# 12 — PLAN EKSEKUSI 1–3 (siap dikerjakan)

Keputusan user: **stdio**, **registry**, **icon asli** (dari `Downloads\roblox-svgrepo-com.svg`), **UI-only**.

---

## LANGKAH 1 — Tombol "Roblox" di sidebar

Tujuan: tombol muncul di bawah Canvas (expanded + collapsed), klik membuka launcher chat.

### 1.1 `src/renderer/components/icons/index.tsx`

Tambah setelah blok `hugeIcon` exports (`:179-199`). SVG asli user: `viewBox="0 0 48 48"`,
2 path stroke, `fill:none`.

```tsx
export const Roblox = forwardRef<SVGSVGElement, TermulIconProps>(function Roblox(
  { size = 24, strokeWidth, children: _children, ...props },
  ref
) {
  const requested = Number(strokeWidth ?? 1.5)
  const sw = Number.isFinite(requested) ? requested : 1.5
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      focusable="false"
      data-termul-icon="Roblox"
      {...props}
    >
      <path d="M41.2648,12.6719,14.7123,5.5572a1.666,1.666,0,0,0-2.04,1.178L5.5572,33.2877a1.666,1.666,0,0,0,1.178,2.04l26.5525,7.1147a1.666,1.666,0,0,0,2.04-1.178l7.1147-26.5525a1.666,1.666,0,0,0-1.178-2.04Z" />
      <path d="M29.3193,20.51l-8.1808-2.192a.5133.5133,0,0,0-.6287.3629l-2.192,8.1808a.5133.5133,0,0,0,.3629.6287l8.1808,2.192a.5133.5133,0,0,0,.6287-.3629l2.192-8.1808A.5133.5133,0,0,0,29.3193,20.51Z" />
    </svg>
  )
})
```

Alasan pakai `strokeWidth ?? 1.5`: konsisten dengan `hugeIcon` (`:156-157`). SVG asli
pakai stroke tebal; 1.5 membuatnya setara icon lain.

### 1.2 `src/renderer/components/shell/RailExpanded.tsx`

- `import { Edit2, Roblox, Search } from '@/components/icons'` (`:1`)
- Interface: tambah `onOpenRoblox: () => void` + `canOpenRoblox: boolean` (`:19-20`)
- Destructure (`:44`)
- Sisipkan `<RailRow>` **setelah** Canvas (`:73`), **sebelum** `</div>` (`:74`):

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

### 1.3 `src/renderer/components/shell/RailCollapsed.tsx` — WAJIB

Tanpa ini tombol hilang saat rail diciutkan. Sisipkan setelah Canvas (`:188`):

```tsx
<RailButton
  label="Open Roblox"
  hint={canOpenRoblox ? undefined : NEED_PROJECT}
  aria-label="Open Roblox"
  disabled={!canOpenRoblox}
  onClick={onOpenRoblox}
>
  <Roblox size={16} />
</RailButton>
```

**API terverifikasi** — `RailButton` dari `@/components/shell/rail-button`
(`RailCollapsed.tsx:6`), props di `rail-button.tsx:53-69`:
```ts
{ label, hint?, 'aria-label': string, description?, disabled?, pressed?,
  badge?, size?: 'md'|'sm', onClick, children }
```
Catat: `aria-label` **wajib** (bukan opsional) — beda dari `RailRow` yang
`name?` opsional. `size` default `'md'` = 36px.

Props di `RailCollapsed.tsx`: `:24` (`canOpenCanvas`) → tambah `canOpenRoblox`;
`:23` (`onOpenCanvas`) → tambah `onOpenRoblox`; destructure `:121`; import icon.

### 1.4 `src/renderer/components/shell/ShellRail.tsx`

- Interface `:14-26`: tambah `onOpenRoblox`, `canOpenRoblox`
- Destructure `:51`
- Teruskan ke `<RailExpanded>` (`:90-99`) dan `<RailCollapsed>` (`:107-113`)

### 1.5 `src/renderer/components/shell/ShellFrame.tsx`

`:160-176` — teruskan dua prop baru. Sumber `canOpenCanvas` ada di sini:

```tsx
canOpenCanvas={Boolean(activeProject?.path)}   // :171
```

Jadi `canOpenRoblox={Boolean(activeProject?.path)}` — aturan sama: butuh project
terbuka. (Bukan `activeProjectId` seperti dugaan awal; `ShellFrame` memakai objek
`activeProject`.)

### 1.6 `src/renderer/layouts/workspace-layout/WorkspaceModals.tsx`

- Interface `:67` — tambah `handleOpenRoblox`
- Destructure `:94`
- `:161` — `onOpenRoblox={handleOpenRoblox}`

### 1.7 Handler

Ikuti pola `:153-158` (buka launcher):

```tsx
const handleOpenRoblox = () => {
  const paneId = useWorkspaceStore.getState().activePaneId
  if (!paneId) return
  setRobloxMode(true)                              // Langkah 2
  useWorkspaceStore.getState().showAgentLauncher(paneId)
}
```

`showAgentLauncher(paneId)` hanya set `agentLauncherPaneId`
(`stores/workspace-store/slices/pane.ts:48-50`).

`canOpenRoblox` = `Boolean(activeProject?.path)` — **sama persis** dengan
`canOpenCanvas` (`ShellFrame.tsx:171`), dihitung di `ShellFrame`, bukan di
`WorkspaceModals`. Jadi `WorkspaceModals` hanya meneruskan `handleOpenRoblox`;
tidak perlu menghitung `canOpenRoblox` sendiri.

### Acceptance Langkah 1
- [ ] "Roblox" muncul tepat di bawah Canvas (expanded)
- [ ] Muncul juga di collapsed rail
- [ ] Klik → launcher terbuka
- [ ] Tanpa project → disabled + tooltip "Open a project first"

---

## LANGKAH 2 — Claude-only (UI saja)

### 2.1 Mekanisme

`AgentLauncher.tsx:284`:
```tsx
const supportedAgents = useResolvedSupportedAcpAgents(acpConfigs)
```

Titik filter: **setelah** baris ini, sebelum dipakai di `:312-317`, `:951-1002`.

Id Claude: `CLAUDE_AGENT_CONFIG_ID = 'acp-registry:claude-acp'`
(`stores/claude-account-switch.ts:26`).

### 2.2 Perubahan

Tambah flag di store launcher (atau `workspace-store`):

```ts
robloxMode: boolean
setRobloxMode: (on: boolean) => void
```

Lalu di `AgentLauncher.tsx`:

```tsx
const allAgents = useResolvedSupportedAcpAgents(acpConfigs)
const robloxMode = useWorkspaceStore((s) => s.robloxMode)
const supportedAgents = useMemo(
  () => (robloxMode
    ? allAgents.filter((e) => e.configId === CLAUDE_AGENT_CONFIG_ID)
    : allAgents),
  [allAgents, robloxMode]
)
```

**Penting:** `robloxMode` harus di-reset `false` saat launcher ditutup, supaya
jalur normal (Ctrl+T / command palette) tidak ikut terfilter. Reset di
`hideAgentLauncher` (`slices/pane.ts:52-54`) atau saat launcher unmount.

### 2.3 Kalau Claude tidak terpasang

Filter bisa menghasilkan array kosong. `pickDefaultSupportedAgent` (`:313`) lalu
`supportedAgents[0]` → `null` (`:314-315`). Perlu empty-state: "Claude Code belum
terpasang" + tombol install, bukan launcher kosong tanpa penjelasan.

### Acceptance Langkah 2
- [ ] Launcher dari tombol Roblox hanya menampilkan Claude
- [ ] Launcher dari Ctrl+T tetap semua agent
- [ ] Tutup launcher Roblox → buka Ctrl+T → semua agent kembali
- [ ] Claude tidak terpasang → pesan jelas

---

## LANGKAH 3 — Studio MCP masuk session

### 3.1 Discovery (Rust, baru)

Termul nol kode Roblox (verified: grep hanya 2 false positive). Port dari RobloxKit
`app/src-tauri/src/studio.rs:48-74`.

File baru: `src-tauri/src/roblox.rs`

```rust
pub fn find_studio_mcp() -> Option<PathBuf> {
    // 1. env STUDIO_MCP_EXE
    if let Ok(p) = std::env::var("STUDIO_MCP_EXE") {
        if !p.is_empty() {
            let pb = PathBuf::from(p);
            if pb.exists() { return Some(pb); }
        }
    }
    // 2. %LOCALAPPDATA%\Roblox\Versions\*\StudioMCP.exe
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let base = root.join("Roblox").join("Versions");
    for entry in std::fs::read_dir(base).ok()?.flatten() {
        let candidate = entry.path().join("StudioMCP.exe");
        if candidate.exists() { return Some(candidate); }
    }
    None
}
```

**Jangan cache hasilnya.** Folder `version-<hash>` berubah tiap update Roblox.

### 3.2 Command

```rust
#[tauri::command]
pub fn roblox_studio_path() -> RobloxStudioStatus { /* { found, path } */ }
```

Daftarkan di `lib.rs:1911` (`generate_handler!`).

**Wajib** (aturan repo):
- Parity trio: adapter + export `api.ts` + test file
  (`parity-checklist.test.ts:237-272`)
- Web surface: gagal rapi (host Linux tak punya Roblox)
- `log` tanpa membocorkan path berisi username mentah

### 3.3 Registry entry

Saat tombol Roblox diklik:

```
roblox_studio_path()
  → found?  tidak → tampilkan "Roblox Studio tidak terpasang"
  → ya → tambah/refresh entry di registry, lalu buka launcher
```

Entry (schema wajib lengkap — `acp-mcp-persistence.ts:58-66`):

```json
{
  "id": "roblox-studio",
  "type": "stdio",
  "name": "roblox-studio",
  "command": "<path hasil scan>",
  "args": [],
  "env": [],
  "enabled": true
}
```

**Mutasi wajib** lewat `runSerializedMcpRegistryMutation` (`slices/mcp.ts:33-38`).
Kalau tidak, dua mutasi bersamaan saling menimpa.

`args: []` dan `env: []` **harus ada** walau kosong — schema ACP menolak kalau
hilang (`acp-mcp-persistence.ts:60-66`).

### 3.4 Kalau path sudah ada tapi basi

Roblox update → hash folder berubah → entry lama menunjuk file yang tidak ada.
Setiap klik, bandingkan `command` lama dengan hasil scan; kalau beda, perbarui.

### Acceptance Langkah 3
- [ ] Studio terpasang → entry dibuat, chat Claude melihat tool Studio
- [ ] Studio tidak terpasang → pesan jelas, tidak crash
- [ ] Roblox update → path di-resolve ulang, tetap jalan
- [ ] Chat non-Roblox tidak terpengaruh
- [ ] Registry tidak korup setelah beberapa kali klik

---

## Urutan pengerjaan

| # | Kerja | Uji |
|---|---|---|
| 1 | Icon | render benar 16px |
| 2 | RailExpanded + RailCollapsed | tombol muncul di dua state |
| 3 | Wiring props 4 lapis | klik → launcher terbuka |
| 4 | `robloxMode` + filter | Claude-only, tidak bocor |
| 5 | `roblox.rs` + command | scan benar di mesin ini |
| 6 | Registry entry + serialisasi | entry muncul, tidak korup |

Langkah 1–4 **murni frontend**, bisa dites tanpa Rust. Langkah 5–6 baru butuh build.

## Test yang harus ikut berubah

### `ShellRail.test.tsx` — akan GAGAL kalau props baru tidak ditambahkan

`buildProps()` (`:69-80`) membangun fixture `ShellRailProps`. Menambah dua prop
wajib ke `ShellRailProps` membuat file ini gagal typecheck.

Wajib diubah:
- `:69-80` — tambah `onOpenRoblox: vi.fn()`, `canOpenRoblox: true`
- Tambah kasus: klik baris Roblox → `expect(props.onOpenRoblox).toHaveBeenCalledTimes(1)`
  (pola sama seperti `:189` untuk Canvas)
- Tambah kasus: `canOpenRoblox: false` → tidak terpanggil (pola `:198`)

### `ShellFrame.test.tsx` — juga menyentuh props ini

`:168`, `:186` meng-assert `canOpenCanvas`. Tambah assert setara untuk
`canOpenRoblox`, termasuk kasus `activeProject` kosong → `false`.

### Test baru Langkah 2

Kasus wajib (ini yang mencegah bug "filter bocor"):

```
1. robloxMode=true  → daftar agent panjang 1, configId = acp-registry:claude-acp
2. robloxMode=false → daftar agent = semua
3. buka Roblox → tutup → buka Ctrl+T → semua agent kembali
4. robloxMode=true, Claude tidak terpasang → empty-state, bukan crash
```

### Test baru Langkah 3

Rust, sibling file sesuai `AGENTS.md:30` (`src-tauri/src/roblox_tests.rs`):

```
1. STUDIO_MCP_EXE menunjuk file ada        → Some(path itu)
2. STUDIO_MCP_EXE menunjuk file tidak ada  → fallback scan
3. LOCALAPPDATA kosong                     → None (tidak panic)
4. Versions/ berisi folder tanpa exe       → None
```

**Jangan** buat test yang bergantung pada hash versi Roblox asli — akan pecah
tiap update. Pakai direktori temp.

## File yang disentuh

```
src/renderer/components/icons/index.tsx
src/renderer/components/shell/RailExpanded.tsx
src/renderer/components/shell/RailCollapsed.tsx
src/renderer/components/shell/ShellRail.tsx
src/renderer/components/shell/ShellFrame.tsx
src/renderer/layouts/workspace-layout/WorkspaceModals.tsx
src/renderer/components/agents/AgentLauncher.tsx
src/renderer/stores/workspace-store/slices/pane.ts        (robloxMode)
src/renderer/stores/workspace-store/types.ts
src-tauri/src/roblox.rs                                    (baru)
src-tauri/src/lib.rs
src-tauri/src/commands/…                                   (command)
src/renderer/lib/…                                         (adapter + api)
```

≈13 file. Di bawah batas 50 file/PR (`AGENTS.md:14`).

## Risiko

| Risiko | Mitigasi |
|---|---|
| Lupa RailCollapsed | masuk acceptance Langkah 1 |
| `robloxMode` bocor ke Ctrl+T | reset saat hide/unmount + test |
| Path Studio basi | resolve tiap klik, jangan cache |
| Registry korup | serialisasi mutasi |
| Icon trademark | sudah disetujui; ganti bila dipublikasi |
