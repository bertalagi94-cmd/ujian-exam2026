// src/lib/sync-essay-input.ts
//
// Normalisasi payload autosave essay (POST /api/siswa/ujian/essay/jawab).
//
// MASALAH: sync PG sudah memakai normalisasiJawabanMasuk() (lihat
// sync-jawaban-input.ts), tetapi jalur essay belum. Isi `jawaban` datang dari
// client yang tidak dipercaya, sehingga:
//   - elemen null / bukan objek membuat `j.soal_essay_id` melempar TypeError
//     (500, bukan 400);
//   - soal_essay_id kembar dalam satu batch membuat INSERT ... ON CONFLICT DO
//     UPDATE di sync_jawaban_essay_revisi() gagal ("cannot affect row a second
//     time") -- seluruh batch ditolak dan outbox mencoba lagi tanpa henti;
//   - revisi pecahan / negatif / terlalu besar gagal di cast ::int;
//   - jawaban_teks yang bukan string melewati batas 20.000 karakter karena
//     pengecekan lama hanya berlaku untuk tipe string.
//
// Aturan: elemen yang formatnya salah DIBUANG (bukan menolak seluruh request),
// supaya autosave yang sah tetap jalan. soal_essay_id kembar digabung dengan
// mempertahankan revisi tertinggi.

export const MAKS_JAWABAN_ESSAY_PER_REQUEST = 100
export const MAKS_PANJANG_TEKS_ESSAY = 20_000
const MAKS_PANJANG_SOAL_ID = 128
const MAKS_INT4 = 2_147_483_647

export interface JawabanEssayMasuk {
  soal_essay_id: string
  jawaban_teks: string
  revisi?: number
  waktuJawabMs?: number
}

export interface HasilNormalisasiEssay {
  records: JawabanEssayMasuk[]
  dibuangFormat: number
  digabungKembar: number
  /** Jumlah elemen yang dibuang karena jawaban_teks melebihi batas panjang. */
  terlaluPanjang: number
}

export function normalisasiJawabanEssayMasuk(raw: unknown): HasilNormalisasiEssay {
  if (!Array.isArray(raw)) {
    return { records: [], dibuangFormat: 0, digabungKembar: 0, terlaluPanjang: 0 }
  }

  const perSoal = new Map<string, JawabanEssayMasuk>()
  let dibuangFormat = 0
  let digabungKembar = 0
  let terlaluPanjang = 0

  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { dibuangFormat++; continue }
    const o = item as Record<string, unknown>

    const id = o.soal_essay_id
    if (typeof id !== 'string' || id.length === 0 || id.length > MAKS_PANJANG_SOAL_ID) { dibuangFormat++; continue }

    // jawaban_teks boleh kosong (siswa menghapus isi jawaban), tetapi harus string.
    const teks = o.jawaban_teks
    if (typeof teks !== 'string') { dibuangFormat++; continue }
    if (teks.length > MAKS_PANJANG_TEKS_ESSAY) { terlaluPanjang++; continue }

    const r = o.revisi
    const revisi = typeof r === 'number' && Number.isInteger(r) && r >= 0 && r <= MAKS_INT4 ? r : undefined

    const w = o.waktuJawabMs
    const waktuJawabMs = typeof w === 'number' && Number.isFinite(w) ? w : undefined

    const baru: JawabanEssayMasuk = { soal_essay_id: id, jawaban_teks: teks, revisi, waktuJawabMs }

    const lama = perSoal.get(id)
    if (lama) {
      digabungKembar++
      if ((baru.revisi ?? 0) >= (lama.revisi ?? 0)) perSoal.set(id, baru)
    } else {
      perSoal.set(id, baru)
    }
  }

  return { records: Array.from(perSoal.values()), dibuangFormat, digabungKembar, terlaluPanjang }
}
