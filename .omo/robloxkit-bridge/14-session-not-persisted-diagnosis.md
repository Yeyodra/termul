# 14 — Diagnosis: chat Roblox hilang setelah reopen

## Kesimpulan: session TIDAK hilang. Tersimpan sempurna.

Bukti langsung dari disk (`%APPDATA%\com.termul-manager.app.dev`):

`acp-sessions/sessions.json`:
```json
{
  "sessionId": "94c4ad2a-4c78-4750-9041-2d9e03220c5b",
  "projectId": "3dec7dc3-3d8c-4039-96b2-8a6386c51e54",
  "cwd": "C:\\Users\\Novella",
  "title": "cek roblox studio gw",
  "status": "closed",
  "messageCount": 11,
  "toolCount": 31,
  "discovered": false
}
```

Dan isinya ada di disk:
```
acp-sessions/7337a661-e78c-4ac3-8e9f-45d5bec01aff/
├── messages.jsonl
├── metadata.json
└── tool-calls.jsonl
```

`projects.json`:
```json
{ "id": "3dec7dc3-3d8c-4039-96b2-8a6386c51e54", "name": "Roblox",
  "path": "\\\\?\\C:\\Users\\Novella" }
```

**`projectId` session cocok persis dengan project Roblox.** Tidak ada data hilang.

## Penyebab sebenarnya: scoping sidebar

`store.json` mencatat:
```
"active-project": "dc0bd615-8cc0-4f74-8a29-07d0754f9006"   ← Kampus, bukan Roblox
```

`use-chat-history-entries.ts` memfilter history dengan
`scopeSessionIndex(sessionIndex, activeProjectId, activeCwd, worktreePaths)`.

`acp-history-persistence.ts:437-442`:
```ts
const scoped = entries.filter((entry) => {
  if (entry.projectId !== projectId) return false     // ← chat Roblox dibuang
  const entryCwd = normalizeCwdForScope(entry.cwd)
  if (entryCwd === normalizedCwd) return true
  return worktreePathSet?.has(entryCwd) ?? false
})
```

Jadi saat project aktif = **Kampus**, semua chat milik project **Roblox**
tersembunyi. Bukan karena hilang — karena filternya per-project.

## Perbaikan

Chat Roblox sekarang tetap terlihat dari project mana pun, masuk bucket yang sama
dengan session "unassigned".

`src/renderer/lib/roblox-studio-mcp.ts` — helper baru:
```ts
export function robloxProjectSessions<T extends { projectId?: string }>(
  entries: T[],
  robloxProjectIds: readonly string[]
): T[]
```

`src/renderer/components/chat/use-chat-history-entries.ts` — sertakan chat Roblox
di `unassignedIds`:
```ts
const robloxProjectIds = useMemo(
  () => allProjects.filter((p) => p.name === ROBLOX_PROJECT_NAME).map((p) => p.id),
  [allProjects]
)
const unassignedIds = useMemo(() => {
  const ids = new Set(unassignedSessions(sessionIndex).map((entry) => entry.id))
  // Roblox chats stay reachable from every project: the Roblox project is a
  // convenience root the user never picked, unlike a real project scope.
  for (const entry of robloxProjectSessions(sessionIndex, robloxProjectIds)) ids.add(entry.id)
  return ids
}, [sessionIndex, robloxProjectIds])
```

## Kenapa pendekatan ini, bukan yang lain

| Alternatif | Masalah |
|---|---|
| Set `projectId` kosong untuk chat Roblox | Host menstempel sentinel `unassigned`; chat jadi milik "tidak ada project", dan `openHistorySession` tidak tahu cwd mana yang dipakai |
| Nonaktifkan scoping saat `robloxMode` | `robloxMode` sudah di-reset saat launcher ditutup — chat akan hilang lagi begitu mode mati |
| Buat Roblox jadi project aktif permanen | Merampas project kerja user |
| **Sertakan chat Roblox di semua project** | Chat tetap punya project asal (benar), tapi tetap terlihat (berguna) |

## Verifikasi

| Cek | Hasil |
|---|---|
| `bun run typecheck` | bersih |
| `roblox-studio-mcp.test.ts` | **13 passed** (3 test baru untuk `robloxProjectSessions`) |
| Data di disk | session utuh, 11 pesan, 31 tool call |

## Yang belum diuji

Chat Roblox **belum diverifikasi muncul di sidebar** setelah perbaikan ini —
butuh menjalankan ulang app dan membuka project mana pun. Test unit menutupi
logika helper-nya, bukan render sidebar.

## Catatan: kenapa `\\?\` di path project

`projects.json` menyimpan `\\?\C:\Users\Novella` (prefix verbatim Windows).
Itu ditulis oleh Rust `Path::canonicalize`. `normalizeCwdForScope`
(`acp-history-persistence.ts:455-467`) sudah menanganinya dengan benar, jadi ini
bukan penyebab masalah — tapi bagus untuk diketahui kalau nanti ada bug path lagi.
