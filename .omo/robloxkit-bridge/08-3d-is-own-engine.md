# 08 — Jawaban: 3D itu engine sendiri, bukan Studio

Pertanyaan: *"yang di app, 3D-nya udah jalan. Itu pure MCP RobloxStudio atau
engine?"*

**Jawaban: engine sendiri.** Studio cuma dipakai di langkah terakhir untuk
menaruh hasilnya.

## Bukti: pemisahan jalurnya jelas

`index-DPVV2ya5.js:18184` mendefinisikan himpunan tool yang menyentuh Studio:

```js
var qc = new Set([
  `search_game_tree`, `inspect_instance`, `read_console`, `execute_luau`,
  `list_scripts`, `read_script`, `edit_script`, `capture_viewport`, `studio_state`,
  `send_3d_to_studio`, `send_vfx_to_studio`, `send_icon_to_studio`,
  `send_sfx_to_studio`, `insert_music`
]);
```

Perhatikan yang **tidak** ada di situ:

| Tool 3D | Masuk `qc` (Studio)? |
|---|---|
| `generate_3d` | ❌ **tidak** |
| `edit_3d` | ❌ **tidak** |
| `get_3d_model` | ❌ **tidak** |
| `list_3d_collection` | ❌ **tidak** |
| `send_3d_to_studio` | ✅ ya |

Jadi: **membuat model = 100% lokal, tanpa Studio.** Cuma mengirim ke Studio yang
butuh Studio.

## Arsitektur sebenarnya

```
"bikin mobil"
     │
     ▼
generate_3d                    ← LOKAL, tanpa Studio
     │  AI bikin spec JSON
     ▼
engine-DoiMMBHL.js::generate() ← LOKAL, three.js + CSG
     │  → model 3D (mesh)
     ▼
exportFiles() → .glb / .obj    ← LOKAL, file
     │
     ▼
send_3d_to_studio              ← BARU DI SINI butuh Studio
     │  lewat `studio_call` (index-DPVV2ya5.js:2345 area, modul studioCall)
     ▼
Roblox Studio
```

Modul `studioCall-DEchKzj8.js` membuktikan lapisan Studio itu tipis — **46 baris**:

```js
function i(t, n, i = {}) {
  if (t) {
    return r(() => e(`studio_call`, {
      name: n,
      arguments: { studio_id: t, ...i }
    }), t);
  }
  return Promise.reject(Error(`No Studio instance selected`));
}
```

Itu satu-satunya cara 3D menyentuh Studio: panggil `studio_call` dengan
`studio_id`. Tidak ada logika 3D di situ.

## Kenapa ini penting untuk kamu

Kalau tujuanmu **bikin model 3D**, maka **kamu tidak butuh Roblox Studio sama
sekali** untuk 90% pekerjaan. Yang kamu butuh:

1. AI yang mengubah prompt → spec JSON
2. Engine yang mengubah spec → mesh (`engine-DoiMMBHL.js`, 637 baris, terbaca)
3. Export `.glb` / `.obj` (`toGlb`, `toObj` — sudah ada)

Studio cuma dipakai kalau kamu mau **menaruh** modelnya ke game. Itu langkah
terakhir dan paling mudah (`studio_call` satu panggilan).

## Konsekuensi untuk "prematur/one-shot" yang kamu lihat

Kamu bilang versi di app-nya masih prematur / one-shot. Itu masuk akal, karena:

- **Langkah 1 (prompt → spec)** bergantung pada prompt AI di `prompts/3d/` yang
  **diambil dari server robloxkit.dev** (`gen3d-BAdfthxw.js:565`), dan **tidak
  ikut ter-extract** (tidak ada folder `prompts/` di artifacts).
- Kalau server/prompt-nya lemah atau kena limit, hasilnya one-shot dangkal.

Jadi yang "prematur" itu kemungkinan besar **lapisan prompt-nya**, bukan
engine-nya. Engine-nya sendiri (637 baris, CSG, rig, GLB export) terlihat utuh.

## Yang bisa kamu pakai sekarang

| Bagian | Status | Usaha port |
|---|---|---|
| `engine-DoiMMBHL.js` (spec → mesh → GLB/OBJ) | ✅ lengkap, terbaca | sedang — port JS → TS |
| Format spec 3D | ✅ terbaca | kecil |
| `send_3d_to_studio` | ✅ 46 baris, jelas | kecil — 1 panggilan `studio_call` |
| Prompt "mobil" → spec JSON | ❌ **hilang** | tulis sendiri + pakai agent Termul |
| Template rig (R15/R6/custom) | ✅ ada (`buildRigObject`, `templateCatalogue`) | ikut engine |
| CSG / BSP (`spec-D11M_y_m.js`) | ✅ ada | ikut engine |

## Rencana minimal untuk tujuanmu

Kalau fokusnya **3D**, ini urutan paling pendek:

1. **Port `engine-DoiMMBHL.js`** ke Termul (TypeScript). Ini inti — tanpa ini
   tidak ada model.
2. **Tulis prompt sendiri** untuk prompt → spec. Pakai agent ACP Termul yang sudah
   ada; kasih schema spec-nya sebagai konteks. (Ini menggantikan `prompts/3d/`
   yang hilang, dan justru bisa lebih bagus karena kamu kontrol.)
3. **Export `.glb`/`.obj`** — sudah ikut di engine, tinggal panggil.
4. **Studio opsional** — kalau mau masuk ke game, pakai `studio_call` /
   registry MCP StudioMCP. Bisa belakangan.

Langkah 1–3 **tidak butuh Roblox Studio** dan **tidak butuh Open Cloud**.

## Yang belum gw verifikasi

- Apakah `engine-DoiMMBHL.js` bisa jalan di luar bundler Vite (ada
  `__vite__mapDeps` di file itu).
- Seberapa dalam ketergantungan ke `spec-D11M_y_m.js` (CSG) — perlu dibaca saat
  porting.
- Isi `templateCatalogue` — berapa banyak template bawaan.
