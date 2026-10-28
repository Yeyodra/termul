# 10 — Registry per-machine, dan kenapa itu justru menyelesaikan masalah

Pertanyaan user: *"kl registry sesuai local machine user masing-masing dong?"*

Jawaban: **registry MCP Termul memang sudah per-mesin, otomatis.** Tapi ada satu
bagian yang tetap harus dikerjakan: **path `StudioMCP.exe` itu berisi folder
versi Roblox yang berbeda di tiap mesin**, jadi tidak boleh di-hardcode.

## 1. Registry-nya sudah per-mesin (verified)

`src/renderer/lib/acp-mcp-persistence.ts:176-189`:

```ts
/**
 * The registry is one list. Desktop keeps it once in the app store; a web
 * client reads the host file of the project it names (`projectId`, the active
 * project); an empty id (no project yet) loads nothing.
 */
export async function loadMcpServers(projectId: string): Promise<StoredMcpServer[]> {
  if (!isTauriContext() && !projectId) return []
  const res = isTauriContext()
    ? await persistenceApi.read<unknown>(PersistenceKeys.acpMcpServers)
    : await webServerMcpServers.get(projectId as string)
```

Storage key: `PersistenceKeys.acpMcpServers = 'acp/mcp-servers'`
(`src/shared/types/persistence.types.ts:92`).

Artinya:
- **Desktop:** satu list di app store lokal (`%APPDATA%`-nya user). Mesin A dan
  mesin B punya registry masing-masing. **Tidak ada sinkronisasi** — dan itu
  perilaku yang benar untuk path yang spesifik mesin.
- **Web/`termul-server`:** dibaca dari file host milik project
  (`.termul/mcp-servers.json`), lewat `syncMcpRegistryToProjectBestEffort`
  (`acp-mcp-persistence.ts:240-245`).

Jadi tidak perlu kerja tambahan untuk "per-mesin". **Sudah begitu.**

## 2. Tapi ini bagian yang TIDAK boleh di-hardcode

Path `StudioMCP.exe` mengandung **folder versi Roblox**:

```
%LOCALAPPDATA%\Roblox\Versions\version-7aaa6838d36c4448\StudioMCP.exe
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^
                                   beda tiap mesin & tiap update Roblox
```

Di mesin user lain hash itu berbeda. Setiap Roblox update, hash-nya **berubah
lagi** di mesin yang sama.

Kalau kita hardcode path ini ke dalam registry default, hasilnya:
- mesin lain → path tidak ada → gagal
- mesin sendiri setelah update Roblox → path basi → gagal diam-diam

**Ini persis alasan RobloxKit punya fungsi discovery** (RobloxKit
`app/src-tauri/src/studio.rs:48-74`): scan
`%LOCALAPPDATA%\Roblox\Versions\*\StudioMCP.exe`.

## 3. Jadi desain yang benar

Bukan "menyimpan path", tapi **"menemukan path saat dipakai"**.

### Saat user klik "Roblox" pertama kali

```
1. Resolve StudioMCP.exe di mesin ini:
     a. env STUDIO_MCP_EXE (override manual)
     b. scan %LOCALAPPDATA%\Roblox\Versions\*\StudioMCP.exe
     c. tidak ketemu → tampilkan pesan "Roblox Studio tidak terpasang"

2. Kalau ketemu:
     tambahkan entry ke registry LOKAL mesin ini
     { type: "stdio", name: "roblox-studio", command: "<path hasil scan>" }

3. Buka chat baru dengan Claude + entry itu
```

Hasilnya: registry tetap per-mesin (sudah bawaan), dan path-nya **diresolve
ulang** setiap kali, bukan disimpan sekali lalu basi.

### Kalau Roblox update

Path lama jadi tidak valid. Dua pilihan:

| Strategi | Perilaku |
|---|---|
| **Resolve tiap launch** (disarankan) | selalu benar, tidak pernah basi |
| Simpan + validasi | cek `fs.exists()`; kalau hilang, scan ulang |

Yang **jangan** dilakukan: menyimpan path lalu memakainya tanpa cek.

## 4. Implikasi ke rencana

Ini menambah satu komponen kecil yang belum ada di rencana sebelumnya:

| Komponen | Isi | Di mana |
|---|---|---|
| `resolve_studio_mcp()` | scan `Versions\*\StudioMCP.exe` + env override | Rust, `src-tauri/src/` |
| Command `roblox_studio_path` | kembalikan `{ found, path? }` | Tauri command + web route |
| Tombol "Roblox" | panggil command itu, lalu tambah ke registry & buka chat | renderer |

Karena ini **Tauri command baru**, aturan parity berlaku
(`parity-checklist.test.ts:237-272`): butuh adapter + export `api.ts` + test file.
Dan di surface web/`termul-server`, command ini harus gagal dengan rapi (tidak ada
Roblox di host Linux).

## 5. Kenapa ini tetap lebih baik daripada pendekatan RobloxKit

RobloxKit **mengasumsikan** Studio ada di mesin yang sama dan langsung
men-spawn-nya. Termul, karena registry-nya sudah per-mesin dan per-project, bisa:

- menampilkan "Roblox Studio tidak ditemukan" alih-alih gagal saat connect
- membiarkan user meng-override path (env atau edit registry)
- tetap berfungsi untuk project yang tidak memakai Roblox

## 6. Ringkas

| Pertanyaan | Jawaban |
|---|---|
| Registry per-mesin? | **Ya, sudah.** App store lokal (desktop) / file project (web). |
| Perlu ubah storage? | **Tidak.** |
| Yang perlu dikerjakan | **Discovery path** `StudioMCP.exe` (scan `Versions\*\`). |
| Kenapa | Path mengandung folder versi yang beda tiap mesin & tiap update. |
| Kapan di-resolve | Setiap kali tombol "Roblox" dipakai, bukan sekali simpan. |

## 7. Status verifikasi

Verified dengan `file:line`:
- storage key + per-mesin/per-project split (`acp-mcp-persistence.ts:176-189`)
- mirror ke `.termul/mcp-servers.json` (`:240-245`)
- `PersistenceKeys.acpMcpServers` (`persistence.types.ts:92`)
- path Roblox berisi folder versi (glob mesin ini:
  `Versions\version-7aaa6838d36c4448\StudioMCP.exe`)

Belum diverifikasi:
- Apakah sudah ada helper Rust untuk scan `Versions\*\` di Termul (dugaan: belum;
  perlu dicek sebelum menulis yang baru).
- Apakah `persistenceApi.read` desktop benar-benar di `%APPDATA%` (belum dibaca
  implementasinya).

## 8. Update: dua hal di atas sudah dicek

**Tidak ada kode Roblox di Termul.** Grep `Roblox|roblox|StudioMCP|Versions` di
`src-tauri/src/` → hanya 2 hit, keduanya **bukan** Roblox:
- `canvas/persistence/mod.rs`
- `server_update.rs:156` — komentar `compareVersions`, soal versi termul-server

Jadi **discovery `StudioMCP.exe` harus ditulis dari nol.** Tidak ada yang bisa
dipakai ulang selain pola `find_studio_mcp` milik RobloxKit
(`app/src-tauri/src/studio.rs:48-74`), yang bisa di-port.

**`.termul/` di-gitignore** (`.gitignore:91`). Artinya mirror
`.termul/mcp-servers.json` bersifat **lokal per project**, tidak ikut ter-commit.
Itu benar untuk path yang spesifik mesin — tapi konsekuensinya: kalau user pindah
mesin, entry MCP-nya tidak ikut, dan harus di-resolve ulang. Satu alasan lagi
untuk **resolve saat dipakai**, bukan menyimpan path.
