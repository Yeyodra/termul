# 09 — Rencana: sidebar "Roblox" + MCP embed (Claude only)

Scope yang diminta:
1. Embed MCP di Termul, seperti RobloxKit.
2. Sidebar: item **"Roblox"** di bawah **Canvas**, icon Roblox.
3. Klik → buka **chat baru biasa**.
4. **Claude saja** untuk alur ini.

## 1. RobloxKit pakai HTTP — benar

`re/05-ai-agent-acp-mcp/FINDINGS.md:245-250`:
> Internal MCP server (HTTP, `tiny_http 0.12.0`): bind `127.0.0.1:0`, route `/mcp`,
> `Authorization: Bearer <token>`, protocol `2025-11-25`

## 2. Kendala: Termul belum bisa server MCP lewat HTTP

`src-tauri/Cargo.toml:132-141` — fitur `rmcp` 3.5.0 yang aktif:

```
client, transport-child-process, transport-streamable-http-client-reqwest,
client-side-sse, server, transport-io, macros, auth
```

Yang ada: HTTP **client** + stdio **server**.
Yang **tidak** ada: HTTP **server** transport.

| Opsi | Cara | Risiko |
|---|---|---|
| A | Aktifkan fitur HTTP-server di rmcp (kalau ada) | perlu cek API |
| B | Tulis handler `axum` + panggil `serve_server` per request | sedang; pola sudah ada |
| **C** | **Tetap stdio** (pola `host_mcp` yang sudah jalan) | **nol** |

**Rekomendasi: C dulu.** Bukan karena HTTP salah, tapi:
- Gate `McpServer::Stdio` **selalu lolos** (`gates.rs:43`); `Http` butuh
  `caps.mcp_capabilities.http` yang **belum terbukti** diiklankan Claude ACP.
- Pola stdio child sudah ada, teruji, dipakai Termul untuk `plan`/`ask_user`/canvas.
- HTTP bisa ditambah belakangan tanpa membongkar apa pun.

Kalau tetap mau HTTP karena fidelity, itu Opsi A/B — terima risiko tambahan.

### Kalau memilih HTTP: template sudah ada

`src-tauri/src/agentation/http_server.rs:371-389` — pola yang harus ditiru:

```rust
let secret = uuid::Uuid::new_v4().simple().to_string();          // :372
let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;  // :374
let owned_port = crate::host_perimeter::OwnedPort::claim(addr.port()); // :380
let token = tokio_util::sync::CancellationToken::new();          // :381
tokio::spawn(async move {
    axum::serve(listener, app)
        .with_graceful_shutdown(async move { t.cancelled().await; })  // :386
        .await
});
```

Wajib ikut: `OwnedPort::claim` (`:380`) dan
`host_allow::layer(..., HostAllowList::loopback())` (`:354`).

## 3. Sidebar — rantai lengkap terverifikasi

```
WorkspaceModals.tsx:161   onOpenCanvas={handleOpenCanvas}
  └─ ShellFrame.tsx:160   <ShellRail …>
       └─ ShellRail.tsx:90,99   <RailExpanded onOpenCanvas=…>
            └─ RailExpanded.tsx:59-74   <div> Search + Canvas
```

Titik sisip persis di `RailExpanded.tsx:74` (setelah `</RailRow>` Canvas,
sebelum `</div>` di `:74`), karena `<ProjectSidebar>` mulai di `:76`.

```tsx
// RailExpanded.tsx:59-74 (sekarang)
<div className="flex shrink-0 flex-col gap-0.5 px-2 pt-2">
  <RailRow label="Search" chip={searchShortcut} icon={<Search size={16} />}
           onClick={onOpenCommandPalette} />
  <RailRow label="Canvas" name="Open canvas"
           hint={canOpenCanvas ? undefined : NEED_PROJECT}
           icon={<Edit2 size={16} />} disabled={!canOpenCanvas}
           onClick={onOpenCanvas} />
</div>
```

`RailRow` sudah generik (`RailRow.tsx:7-22`) — **tidak perlu komponen baru**:
```ts
{ label, name?, hint?, icon: React.ReactNode, chip?, disabled?, pressed?, onClick }
```

### File yang harus disentuh (rantai props)

| File | Perubahan |
|---|---|
| `components/icons/index.tsx` | tambah export `Roblox` (pola `hugeIcon(...)` `:179-196`) |
| `components/shell/RailExpanded.tsx` | tambah `onOpenRoblox` prop + `<RailRow>` |
| `components/shell/RailCollapsed.tsx` | **opsional** — kalau rail bisa collapse, ikon juga perlu (`:23, 120, 185` punya `onOpenCanvas`) |
| `components/shell/ShellRail.tsx` | teruskan `onOpenRoblox` (`:14-26` interface, `:90-113` render) |
| `components/shell/ShellFrame.tsx` | teruskan (`:160`) |
| `layouts/workspace-layout/WorkspaceModals.tsx` | teruskan `handleOpenRoblox` (`:67, 94, 161`) |
| pemilik `handleOpenCanvas` | implementasi `handleOpenRoblox` |

**Catatan penting:** `RailCollapsed` juga punya `onOpenCanvas` (`:185`). Kalau
rail dalam keadaan collapsed, item Roblox harus tetap bisa diakses — kalau tidak,
fitur hilang saat rail diciutkan. Ini mudah terlewat.

### Icon

`components/icons/index.tsx` pakai pola `hugeIcon(name, IconData)` (`:179-196`).
Tidak ada icon Roblox. Perlu SVG path baru.

**Soal merek:** logo Roblox adalah trademark. Untuk pemakaian pribadi aman; kalau
mau dipublikasi, pertimbangkan bentuk generik (kubus/blok miring) atau text-mark.

## 4. Claude-only

Belum gw verifikasi bagaimana launcher memfilter agent. Yang sudah pasti:
`createSession(agentId, cwd, mcpServers, projectId, opts)`
(`stores/acp-store/slices/session.ts:1538`).

Dua cara:
- **(a)** filter daftar agent saat launcher dibuka dari Roblox
- **(b)** set `agentId` = Claude dan sembunyikan picker

(b) lebih dekat ke permintaan "hilangin yang lain".

Perlu dibaca dulu: `components/agents/AgentLauncher.tsx` +
`components/agents/launcher/toolbar.tsx` (keduanya menyebut `mcpServers`),
dan bagaimana picker mengambil daftar agent.

## 5. Urutan kerja

### Langkah 1 — UI saja (tanpa Rust, cepat, bisa langsung dilihat)
- Icon Roblox
- `RailRow` "Roblox" di `RailExpanded.tsx:74`
- teruskan prop lewat `ShellRail` → `ShellFrame` → `WorkspaceModals`
- handler membuka chat baru

Hasil: tombol ada, klik membuka chat. Belum ada MCP.

### Langkah 2 — Claude-only
Filter/force agent untuk alur Roblox.

### Langkah 3 — MCP Roblox
- **3a (disarankan):** pakai registry MCP Termul yang sudah ada; "Roblox" hanya
  menambahkan `StudioMCP.exe` ke session. **Nol kode server.**
- **3b:** embedded MCP sendiri (`FrameKind::Roblox` di `host_mcp`, atau HTTP baru)
  — hanya kalau 3a kurang (butuh `studio_id` auto-inject, permission gate, atau
  tool non-Studio).

## 6. Keputusan yang gw butuh dari lo

1. **HTTP atau stdio?** Gw sarankan stdio dulu.
2. **3a atau 3b?** Registry dulu (nol kode server) vs embedded sendiri.
3. **Icon Roblox asli atau generik?**
4. **"Hilangin yang lain"** = sembunyikan di UI saja, atau tolak juga di backend?

## 7. Status eksplorasi — jujur

Keempat subagent explorer yang gw jalankan **tidak selesai dalam waktu wajar**
(3–4 menit+, mendekati 5 menit). Gw cancel dan ganti dengan pembacaan langsung.

Semua klaim di atas gw verifikasi sendiri dengan `file:line`, **kecuali** yang
ditandai belum diverifikasi:
- Apakah Claude ACP mengiklankan `mcpCapabilities.http = true`.
- Bagaimana launcher memfilter/memilih agent.
- Apakah `rmcp` 3.5 punya fitur HTTP-server (Cargo.lock:5642-5645 konfirmasi
  versi 3.5.0, tapi daftar fitur lengkap crate tidak bisa dibaca offline).
- Di mana `handleOpenCanvas` diimplementasikan (pemiliknya).
