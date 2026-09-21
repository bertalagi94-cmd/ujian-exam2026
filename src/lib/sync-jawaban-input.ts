// Normalisasi & validasi payload `jawaban` untuk POST /api/siswa/ujian/sync.
//
// Body request datang dari client yang TIDAK dipercaya (bisa dimodifikasi lewat
// devtools / dipanggil langsung). Sebelum ada helper ini, route langsung memakai
// array mentah dari req.json(), sehingga:
//
//   1. Elemen null / bukan objek  -> TypeError di `j.soal_id` (500).
//   2. soal_id GANDA dalam satu batch -> Postgres menolak seluruh perintah
//      `INSERT ... ON CONFLICT DO UPDATE` (error 21000 "cannot affect row a
//      second time") di dalam sync_jawaban_revisi(), sehingga SELURUH batch
//      (termasuk jawaban sah lain di request yang sama) gagal 500.
//   3. `revisi` pecahan (1.5) atau di luar rentang int4 -> cast `::int` di SQL
//      gagal (22P02 / 22003) -> seluruh batch 500.
//   4. `jawaban` bukan string / berukuran sangat besar -> tersimpan apa adanya
//      di tabel `jawaban`.
//
// Fungsi ini murni (tanpa I/O) supaya mudah diuji.

import type { JawabanMasuk } from '@/lib/deadline-pg'

/** Batas atas jumlah elemen `jawaban` per request (paket soal sekolah << ini). */
export const MAKS_JAWABAN_PER_REQUEST = 500
/** Label pilihan jawaban ('A'..'E' dst) selalu pendek. '' dipakai untuk "dikosongkan". */
export const MAKS_PANJANG_JAWABAN = 16
const MAKS_PANJANG_SOAL_ID = 128
const MAKS_INT4 = 2_147_483_647

export interface HasilNormalisasi {
  /** Rekaman bersih: unik per soal_id, tipe sudah pasti benar. */
  records: JawabanMasuk[]
  /** Jumlah elemen mentah yang dibuang karena bentuknya tidak valid. */
  dibuangFormat: number
  /** Jumlah elemen yang digabung karena soal_id kembar. */
  digabungKembar: number
}

export function normalisasiJawabanMasuk(raw: unknown): HasilNormalisasi {
  if (!Array.isArray(raw)) return { records: [], dibuangFormat: 0, digabungKembar: 0 }

  const perSoal = new Map<string, JawabanMasuk>()
  let dibuangFormat = 0
  let digabungKembar = 0

  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { dibuangFormat++; continue }
    const o = item as Record<string, unknown>

    const soal_id = o.soal_id
    const jawaban = o.jawaban
    if (typeof soal_id !== 'string' || soal_id.length === 0 || soal_id.length > MAKS_PANJANG_SOAL_ID) { dibuangFormat++; continue }
    if (typeof jawaban !== 'string' || jawaban.length > MAKS_PANJANG_JAWABAN) { dibuangFormat++; continue }

    // revisi: hanya integer 0..int4. Nilai lain dianggap "tidak dikirim" (=> 0
    // di route), bukan menolak seluruh jawaban -- perilaku yang sama dengan
    // client lama yang tidak mengirim revisi.
    const r = o.revisi
    const revisi = typeof r === 'number' && Number.isInteger(r) && r >= 0 && r <= MAKS_INT4 ? r : undefined

    // waktuJawabMs: hanya angka hingga. Validasi rentang tetap di deadline-pg.ts.
    const w = o.waktuJawabMs
    const waktuJawabMs = typeof w === 'number' && Number.isFinite(w) ? w : undefined

    const baru: JawabanMasuk = { soal_id, jawaban, revisi, waktuJawabMs }

    const lama = perSoal.get(soal_id)
    if (lama) {
      digabungKembar++
      // Pertahankan yang revisinya paling tinggi (sama dgn semantik RPC: revisi
      // tertinggi menang). Kalau sama, yang muncul belakangan menang.
      if ((baru.revisi ?? 0) >= (lama.revisi ?? 0)) perSoal.set(soal_id, baru)
    } else {
      perSoal.set(soal_id, baru)
    }
  }

  return { records: Array.from(perSoal.values()), dibuangFormat, digabungKembar }
}
