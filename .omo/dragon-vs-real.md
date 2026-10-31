# Dragon 1:1 — hasil generate vs naga nyata

Diukur dari `~/Documents/robloxkit/.termul/generated/prop/mythic-dragon-1-1/item.json`
dan `v*.still.png`, bukan dari kesan visual.

## 0. Status akhir (setelah perbaikan 1 & 2)

Dua akar yang membuat naga jelek sudah diperbaiki dan dibuktikan di binary dev sungguhan.

| | v1 (awal) | v5 (sekarang) |
| --- | --- | --- |
| Size | 3.9 × 3.7 × 6.6 m | **12.5 × 6.8 × 14.0 m** |
| Panjang | 6.6 m | **14.0 m** |
| Top part | 8 | 10 |
| Triangles | 8 056 | 11 216 |
| Leher | **9 dari 9 sambungan bolong** | **0 gap** (d/reach 0.79, beririsan) |
| Ekor | — | **0 gap** (d/reach 0.68) |
| Siluet samping | buaya | naga: leher S-curve, ekor menaper, sayap bermembran |
| Skor | 21/100 | — |

Yang berubah:
1. **Timeout `gen/3d` 5 menit → 15 menit.** Sebelumnya turn gagal total
   (`the gen/3d turn produced nothing within 300000 ms`) karena model dipaksa berhenti
   sebelum selesai menulis. v5 berhasil karena timeout ini dinaikkan.
2. **Aturan kontinuitas rantai.** Group boleh ditandai `"chain": true`; validator menolak
   segmen yang jarak pusatnya lebih besar dari jumlah reach keduanya. Model sekarang memakai
   `chain: true` pada Neck dan Tail, dan hasilnya benar-benar bersambung.

## 1. Empat iterasi pertama, satu prompt

Prompt yang sama, `"buat dengan scale 1:1, naga mitologi, besar dan berliuk-liuk dan beribawa"`,
dijalankan lewat UI sungguhan (`bun run dev` → 3D Generator → Apply).

| Versi | Top part | Triangles | Size (studs) | Size (m) | Warna |
| --- | --- | --- | --- | --- | --- |
| v1 | 8 | 8 056 | 13.8 × 13.1 × 23.4 | 3.9 × 3.7 × 6.6 | 7 |
| v2 | 8 | 9 184 | 25.2 × 27.8 × 46.3 | 7.1 × 7.8 × 13.0 | 7 |
| v3 | 8 | 8 844 | 35.7 × 11.0 × 30.4 | 10.0 × 3.1 × 8.5 | 26 |
| v4 | 9 | 9 484 | 36.0 × 11.0 × 30.4 | 10.1 × 3.1 × 8.5 | 26 |
| **v5** | **10** | **11 216** | **44.6 × 24.1 × 50.1** | **12.5 × 6.8 × 14.0** | 14 |

**Panjang sudah benar sejak v2.** 46.3 studs = 13.0 m, dan naga mitologi 12 m memang
sekitar 43 studs. Perbaikan `Scale` di prompt bekerja.

**Tinggi baru benar di v5.** v2–v4 tingginya 11 studs (3 m) — terlalu gepeng untuk naga
beribawa. v5 mencapai 24.1 studs (6.8 m) karena lehernya terangkat sebagai rantai, bukan
tumpukan kotak.

## 2. Dibanding naga sungguhan

Naga 12 m yang "berliuk-liuk dan beribawa" punya sifat yang bisa diperiksa:

| Sifat | Naga nyata | v2 (yang terbaik) | Hasil |
| --- | --- | --- | --- |
| Panjang | 43 studs | 46.3 | **benar** |
| Tinggi | ~18 studs (kepala terangkat) | 27.8 | terlalu tinggi, bukan beribawa |
| Sayap | membentang ~40 studs, membran berjari | 2 batang tipis + 1 group | gagal |
| Leher | satu rantai bersambung, 10–14 segmen | 15 anak, **9 gap** | gagal |
| Ekor | menaper mulus ke ujung | 7 silinder bersambung + kerucut | **benar** |
| Tubuh | satu rantai tanpa lubang | 7 kotak bertumpuk | gagal |
| Kaki | 4, berotot, bertulang | 17 box kecil | sebagian |
| Siluet dari samping | membaca sebagai naga | membaca sebagai buaya | gagal |

### Angka gap leher

Diukur dari `position` tiap segmen dibanding radius/height-nya. `GAP` = jarak antar
pusat lebih besar dari setengah jumlah panjang keduanya, jadi ada ruang kosong.

```
Neck[0->1] dist=2.26 needs<=1.40 GAP 0.86
Neck[1->2] dist=2.23 needs<=1.40 GAP 0.83
Neck[2->3] dist=2.20 needs<=1.40 GAP 0.80
Neck[3->4] dist=2.14 needs<=1.40 GAP 0.74
Neck[4->5] dist=9.35 needs<=0.90 GAP 8.45   <- lompatan 9 studs
Neck[5->6] dist=2.50 needs<=0.40 GAP 2.10
Neck[6->7] dist=2.53 needs<=0.40 GAP 2.13
Neck[7->8] dist=2.57 needs<=0.40 GAP 2.17
Neck[8->9] dist=2.41 needs<=0.40 GAP 2.01
```

Sembilan dari sembilan sambungan punya lubang. Itu "manik-manik melayang" yang terlihat
di render. Ekornya benar (0 gap dari 6) karena di sana model memakai `cylinder` dengan
`radiusTop`/`radiusBottom`/`height` yang benar-benar bersambung — jadi **model bisa
kalau mau**, dan lehernya yang tidak.

### Penyebab leher, bukan tebakan

Leher v2 berisi tiga deret terpisah, bukan satu rantai:

| Deret | Isi | Masalah |
| --- | --- | --- |
| 5 `capsule` | r 1.9→1.4, `length: 1.4` | jarak antar pusat 2.2, panjang total 1.4 + 2r → **tidak menyentuh** |
| 5 `cylinder` | `radiusTop`/`radiusBottom` **tidak ada**, `height: 0.4` | silinder 0.4 stud, jadi cakram tipis yang melayang |
| 5 `cone` | r 0.38→0.28 | duri punggung, bukan leher |

Tiga deret ini ditulis berdampingan, bukan disambung. Karena itu 15 anak menghasilkan
leher yang bolong, bukan leher.

## 3. Kenapa selalu 8 part — akar sebenarnya

`Parts` di UI **bukan** jumlah mesh. Ia membaca `report.parts.length`, dan `report.parts`
berisi satu entri per **part tingkat atas** (`check.ts` → `partGroups`). Satu group
tingkat atas bisa berisi 100 mesh.

Diukur langsung di engine:

| Spec stress | Top part (yang UI sebut "Parts") | Mesh sebenarnya |
| --- | --- | --- |
| dragon | 7 | **132** |
| apartment | 25 | **147** |
| hero | 15 | 21 |
| pickaxe | 4 | 12 |
| backpack | 4 | 22 |
| sign | 3 | 12 |

Jadi angka "Parts 8" pada v1–v4 **tidak berarti modelnya sederhana**. v4 punya 285 node
dan 9 484 triangle. Yang salah adalah angka itu dibaca sebagai ukuran kerumitan, termasuk
oleh saya di iterasi awal.

Ini juga berarti target "parts ≥ 40" di dokumen lama salah satuan: dragon stress saya
lolos dengan 132 mesh tapi hanya 7 top part. Kalau targetnya top part, tidak ada model
wajar yang akan lolos.

## 4. Yang sudah diperbaiki dan terbukti

| Perbaikan | Bukti |
| --- | --- |
| `array`/`mirror` di non-group ditolak validator | dulu diterima lalu dibuang diam-diam; `box` dengan `array.count: 9` jadi 1 part, sekarang error |
| Prompt punya tabel anggaran part + bagian "Curves and taper" | `prompt.ts` |
| Ukuran 1:1 | v1 6.6 m → v2 13.0 m |
| Interior terisi | apartment v4: 26 warna, kasur, TV, permadani, counter |
| Stress test memberi skor, bukan lulus/gagal | baseline prompt asli = **21/100**, dragon stress = **100/100** |

## 5. Yang sudah diperbaiki (1 & 2 selesai)

1. **Timeout `gen/3d`.** `acp-brain-transport.ts` sekarang memakai 900 000 ms untuk
   `gen/3d` dan `gen/clothing`, 300 000 ms untuk scope lain, dan `turnTimeoutMs` masih
   menang kalau caller memberinya. Bukti: v5 selesai (11 216 triangle, 10 top part)
   setelah sebelumnya turn gagal di 300 000 ms.
2. **Kontinuitas rantai.** `chain: true` pada group menyalakan aturan: jarak pusat antar
   segmen tidak boleh lebih besar dari jumlah reach keduanya (sphere = radius, cylinder
   dan capsule = setengah `height`). Pesan errornya menyebut jarak, reach, dan cara
   memperbaikinya. Bukti: spec v2 (yang lama) menghasilkan **21 pelanggaran**; spec stress
   yang sudah diperbaiki 0; output model v5 memakai `chain: true` dan 0 gap.

Tes regresi: `schema.test.ts` (3 tes) + `stress-categories.test.ts` (1 tes).
Seluruh generator: 735 tes hijau, typecheck bersih.

## 6. Yang masih kurang

- **Sayap masih lembaran datar.** v5 punya 10 anak di group Wings, dan dari depan terlihat
  seperti dua layang-layang. Naga nyata punya jari sayap (4–5 tulang) dengan membran di
  antaranya. Prompt belum mengajarkan itu.
- **Belum ada aturan kontinuitas untuk tulang.** Kaki v5 masih tersusun dari blok yang
  bertumpuk tanpa `chain`, jadi bisa saja ada gap yang tidak terdeteksi.
- **`Body` v5 hanya 3 anak.** Torso naga butuh rusuk/dada, bukan tiga kotak.
