# 07 — Kabar bagus: engine generatifnya BISA di-copy

Koreksi untuk `06` dan untuk `DUPLICATION-READINESS.md` Robloxkit.

## Apa yang gw temukan

Dokumen Robloxkit bilang 3D cuma "45% duplication-readiness, geometry/template
bodies unknown". **Itu salah / terlalu pesimis.** Kodenya ada dan bisa dibaca.

`artifacts/frontend_unmin/engine-DoiMMBHL.js` — **637 baris**, sudah di-unminify
(line length rata-rata ~29 char, bukan minified lagi). Export-nya:

```
generate, exportFiles, toGlb, toObj, buildMannequin, buildRigObject,
checkRig, jointWorld, jointsOf, motionDegrees, rigAttachment, rigPose,
rootPartFor, sampleMotion, templateCatalogue, atlasTexture, buildAtlas,
TRIANGLE_LIMIT
```
(`engine-DoiMMBHL.js:539-558`)

Jadi ini **engine prosedural lengkap**, bukan black box.

## Cara kerja "generate 3D" sebenarnya

Bukan AI yang menggambar model. Dua tahap terpisah:

```
1. AI (prompt → spec)          : gen3d-*.js memanggil model dengan
                                 prompts/3d/system.md sebagai system prompt
                                 (gen3d-BAdfthxw.js:565)
2. Engine (spec → geometry)    : engine-DoiMMBHL.js::generate(spec)
                                 → three.js + CSG
                                 → toGlb() / toObj()
```

Artinya: **AI cuma bikin JSON spec.** Mesin yang mengubah spec jadi model 3D itu
deterministik dan **kodenya ada**.

## Kenapa ini penting

| Yang gw kira sebelumnya | Kenyataan |
|---|---|
| 3D harus ditulis dari nol | **engine 637 baris, bisa dibaca & diport** |
| Cuma ada kontrak parameter | ada implementasi penuh (`generate`, `toGlb`, `toObj`) |
| Butuh reverse engineering | sudah di-unminify, nama fungsi asli |

Batasan yang tetap ada:
- Bergantung pada **three.js** (npm publik, aman)
- Bergantung pada **CSG / BSP** (`spec-D11M_y_m.js`)
- Prompt AI-nya di `prompts/3d/` — file teks, ikut ke-copy

## Daftar engine dan status keterbacaannya

| Engine | File sumber | Status |
|---|---|---|
| 3D / procedural | `engine-DoiMMBHL.js` (637 L) | ✅ **terbaca lengkap** |
| Image | `imageEngine-BYji6RWR.js` | ✅ spec + formula kernel exact (`FINDINGS-DEEP-5.md`) |
| SFX | `spec-DKgnETjI.js`, `sfx-C9VkZ_Hq.js` | ✅ formula DSP exact |
| Texture | `worker-BsRVankJ.js` | ✅ worker, parameter lengkap |
| Skybox | `worker-CMNq6f94.js` | ✅ |
| Icons | `spec-Dep-KogR.js` | ✅ SVG path |
| Clothing / gfx / vfx / cutscene / animation | `spec-*.js` | ✅ spec ada |

Semua di `artifacts/frontend_unmin/` — **sudah di-unminify, 166/166 file**.

## Artinya untuk rencana

Track B (parity penuh) jauh lebih mungkin dari yang gw bilang. Ini **bukan**
"tulis dari nol", tapi **port JavaScript → TypeScript/Rust**.

Urutan yang masuk akal berdasarkan nilai per usaha:

1. **Studio editing** (`lp`, 9 tools) — nol kode, pakai registry Termul
2. **3D** — engine 637 baris, paling jelas & paling terlihat hasilnya
3. **Image** — formula sudah exact di FINDINGS-DEEP-5
4. **SFX** — DSP exact
5. **Texture / skybox / icons** — worker-based, self-contained
6. **Open Cloud** (grup `Nf`, 15 tools) — butuh Roblox OAuth, keputusan produk
7. Sisanya (clothing/gfx/vfx/cutscene/animation)

## Yang belum gw verifikasi

- Apakah `engine-DoiMMBHL.js` bisa jalan tanpa bundler Vite (ada `__vite__mapDeps`).
- Seberapa dalam ketergantungan ke internal Robloxkit lain (`brain-*.js`,
  `serverAssets-*.js`, `entitlements-*.js`) — beberapa import itu gate lisensi,
  yang justru **ingin dibuang**.

## Yang sudah gw verifikasi: prompt AI-nya TIDAK ikut ke-extract

`gen3d-BAdfthxw.js:530, 555, 565, 569, 721` memuat prompt lewat loader server:

```js
a(`prompts/3d`, `prompts/3d/categories.json`)
r(`prompts/3d`, `prompts/3d/system.md`)
r(`prompts/3d`, `prompts/3d/rig.json`)
r(`prompts/image-spec.md`)
```

`a` / `r` berasal dari `serverAssets-p9XPPBjy.js` — jadi **file prompt diambil dari
server `robloxkit.dev` saat runtime**, bukan di-embed di bundle.

Cek `artifacts/` → **tidak ada** direktori `prompts/`. Terkonfirmasi:
`glob **/prompts/**` → nol hasil.

**Konsekuensi:** engine 3D-nya bisa diport, tapi **system prompt yang mengubah
"buatkan mobil" jadi spec JSON tidak ada**. Itu harus ditulis sendiri.

Yang tetap bisa dipakai: **format spec-nya** (`engine::generate(spec)` sudah
terbaca), jadi target output-nya jelas. Yang perlu dibuat ulang cuma lapisan
prompt-nya — dan itu bagian paling mudah diganti, karena kamu sudah punya agent
sendiri (ACP) yang bisa menghasilkan JSON spec.

### Jadi pembagian kerja sebenarnya

| Bagian | Status |
|---|---|
| spec → geometry (`generate`, `toGlb`, `toObj`) | ✅ **ada, 637 baris** |
| spec format / parameter | ✅ terbaca |
| prompt: "mobil" → spec JSON | ❌ **hilang, harus ditulis sendiri** |
| prompt: "tekstur bata" → spec | ❌ hilang |

Ini **bukan blocker**. Agent ACP yang sudah ada di Termul bisa mengisi peran itu:
kamu tulis prompt sendiri + schema spec, agent menghasilkan JSON, engine
mengubahnya jadi model.
