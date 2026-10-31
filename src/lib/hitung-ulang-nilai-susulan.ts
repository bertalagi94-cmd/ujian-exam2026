// src/lib/hitung-ulang-nilai-susulan.ts
//
// ── HITUNG ULANG NILAI PG SETELAH JAWABAN SUSULAN DITERIMA ──────────────────
// Konteks: jawaban offline yang dibuat siswa SEBELUM waktunya habis tapi baru
// terkirim SETELAH sesi ditutup sekarang diterima (lihat
// supabase/55_sync_jawaban_setelah_tutup.sql dan /api/siswa/ujian/sync).
// Baris `nilai` siswa itu sudah terbentuk saat sesi ditutup (dari jawaban yang
// waktu itu sudah ada di server), jadi harus dihitung ulang.
//
// ATURAN KEAMANAN (jangan ubah tanpa kebijakan sekolah):
//   - Nilai yang sudah DIKIRIM KE WALI KELAS atau sudah DIRILIS ke siswa tidak
//     pernah diubah otomatis. Sistem hanya menambah catatan di `catatan_guru`
//     supaya guru meninjau.
//   - Nilai yang sudah punya nilai_essay (essay sudah dinilai) juga tidak
//     diubah otomatis, karena nilai_total bergantung pada nilai PG. Guru cukup
//     menyimpan ulang koreksi essay (itu menghitung ulang nilai_total dari
//     nilai PG terbaru) -- sistem memberi catatan.
//   - Nilai gugur total (siswa TERKUNCI) tidak pernah menerima jawaban susulan
//     (ditolak di fungsi database).
//   - Kolom hasil edit manual guru (nilai_edit, grade_edit, lulus_edit) TIDAK
//     disentuh.
//   - Perhitungan selalu dari SEMUA jawaban tersimpan (idempoten): aman
//     dipanggil berulang atau bersamaan.

import { createAdminClient } from '@/lib/supabase'
import { ambilDataSesiUntukPenilaian, hitungHasilPenilaian, GagalMemuatDataPenilaian } from '@/lib/penilaian-ujian'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

type DbClient = ReturnType<typeof createAdminClient>

export type HasilHitungUlang =
  | { hasil: 'TIDAK_BERUBAH' }
  | { hasil: 'DIPERBARUI'; nilaiLama: number | null; nilaiBaru: number }
  | { hasil: 'DITANDAI_UNTUK_GURU'; alasan: 'SUDAH_DIKIRIM_WALI' | 'SUDAH_DIRILIS' | 'ESSAY_SUDAH_DINILAI'; nilaiTersimpan: number | null; nilaiSeharusnya: number }
  | { hasil: 'NILAI_BELUM_ADA' }
  | { hasil: 'GAGAL'; error: string }

const TANDA_SUSULAN = '[SUSULAN]'

function tambahCatatan(lama: string | null | undefined, baru: string): string {
  const dasar = (lama ?? '').trim()
  return dasar ? `${dasar}\n${baru}` : baru
}

export async function hitungUlangNilaiPgSetelahSusulan(
  db: DbClient,
  sesiId: string,
  nis: string
): Promise<HasilHitungUlang> {
  // 1) Baris nilai yang ada. Kalau belum ada, JANGAN dibuat di sini: baris
  //    nilai dibuat oleh /selesai atau finalisasi saat sesi ditutup. Kalau
  //    finalisasi itu gagal, jalurnya adalah admin/sesi/[id]/finalisasi-ulang
  //    yang akan membaca jawaban terbaru (termasuk yang susulan ini).
  const { data: nilaiRow, error: errNilai } = await db
    .from('nilai')
    .select('id, benar, total, nilai, grade, lulus, kkm, nilai_essay, dirilis, dikirim_ke_wali, catatan_guru')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .maybeSingle()
  if (errNilai) return { hasil: 'GAGAL', error: errNilai.message }
  if (!nilaiRow) return { hasil: 'NILAI_BELUM_ADA' }

  // 2) Data penilaian sesi (kunci jawaban, KKM, total soal) -- gagal DB tidak
  //    boleh jatuh jadi nilai 0 (lihat GagalMemuatDataPenilaian).
  let dataSesi: Awaited<ReturnType<typeof ambilDataSesiUntukPenilaian>>
  try {
    dataSesi = await ambilDataSesiUntukPenilaian(db, sesiId)
  } catch (e) {
    if (!(e instanceof GagalMemuatDataPenilaian)) throw e
    return { hasil: 'GAGAL', error: e.message }
  }
  if (!dataSesi) return { hasil: 'GAGAL', error: 'Data sesi untuk penilaian tidak ditemukan.' }
  const { kkm: kkmSesi, totalSoal, kunciMap } = dataSesi
  const kkm = nilaiRow.kkm ?? kkmSesi

  // 3) Semua jawaban tersimpan siswa ini (halaman demi halaman).
  const { data: jawaban, error: errJawaban } = await ambilSemuaBaris<{ soal_id: string; jawaban: string }>(
    (dari, sampai) =>
      db.from('jawaban')
        .select('soal_id, jawaban')
        .eq('sesi_id', sesiId)
        .eq('nis', nis)
        .order('soal_id', { ascending: true })
        .range(dari, sampai)
  )
  if (errJawaban) {
    return { hasil: 'GAGAL', error: `Gagal membaca jawaban untuk hitung ulang (nilai tidak diubah): ${errJawaban.message}` }
  }

  const baru = hitungHasilPenilaian(jawaban, kunciMap, totalSoal, kkm)

  if (baru.benar === nilaiRow.benar && baru.total === nilaiRow.total && baru.nilai === nilaiRow.nilai) {
    return { hasil: 'TIDAK_BERUBAH' }
  }

  // 4) Nilai yang tidak boleh diubah otomatis -> beri tanda untuk guru.
  let alasanKunci: 'SUDAH_DIKIRIM_WALI' | 'SUDAH_DIRILIS' | 'ESSAY_SUDAH_DINILAI' | null = null
  if (nilaiRow.dikirim_ke_wali) alasanKunci = 'SUDAH_DIKIRIM_WALI'
  else if (nilaiRow.dirilis) alasanKunci = 'SUDAH_DIRILIS'
  else if (nilaiRow.nilai_essay !== null && nilaiRow.nilai_essay !== undefined) alasanKunci = 'ESSAY_SUDAH_DINILAI'

  if (alasanKunci) {
    const teksAlasan =
      alasanKunci === 'SUDAH_DIKIRIM_WALI' ? 'nilai sudah dikirim ke wali kelas'
      : alasanKunci === 'SUDAH_DIRILIS' ? 'nilai sudah dirilis ke siswa'
      : 'essay sudah dinilai (nilai akhir bergantung pada nilai PG; simpan ulang koreksi essay setelah nilai PG diperbarui)'
    const catatan = `${TANDA_SUSULAN} Jawaban offline siswa ini diterima SETELAH sesi ditutup, dan menghasilkan nilai PG ${baru.nilai} (${baru.benar}/${baru.total} benar), berbeda dari nilai tersimpan ${nilaiRow.nilai}. Nilai TIDAK diubah otomatis karena ${teksAlasan}. Mohon ditinjau guru.`
    // Jangan menumpuk catatan yang sama berulang kali.
    if (!(nilaiRow.catatan_guru ?? '').includes(catatan)) {
      const { error } = await db
        .from('nilai')
        .update({ catatan_guru: tambahCatatan(nilaiRow.catatan_guru, catatan) })
        .eq('id', nilaiRow.id)
      if (error) return { hasil: 'GAGAL', error: error.message }
    }
    return { hasil: 'DITANDAI_UNTUK_GURU', alasan: alasanKunci, nilaiTersimpan: nilaiRow.nilai ?? null, nilaiSeharusnya: baru.nilai }
  }

  // 5) Perbarui nilai PG. Penjaga tambahan di query (bukan hanya di atas)
  //    supaya kalau nilai SEMPAT dikirim ke wali / dirilis / dinilai essay di
  //    antara pembacaan dan penulisan, update ini tidak mengenai baris itu.
  const catatan = `${TANDA_SUSULAN} Nilai PG dihitung ulang otomatis karena jawaban offline siswa ini diterima setelah sesi ditutup (sebelumnya ${nilaiRow.nilai}, sekarang ${baru.nilai}; ${baru.benar}/${baru.total} benar).`
  const { data: diperbarui, error: errUpdate } = await db
    .from('nilai')
    .update({
      benar: baru.benar,
      total: baru.total,
      nilai: baru.nilai,
      grade: baru.grade,
      lulus: baru.lulus,
      catatan_guru: tambahCatatan(nilaiRow.catatan_guru, catatan),
    })
    .eq('id', nilaiRow.id)
    .is('nilai_essay', null)
    .or('dikirim_ke_wali.is.null,dikirim_ke_wali.eq.false')
    .or('dirilis.is.null,dirilis.eq.false')
    .select('id')
  if (errUpdate) return { hasil: 'GAGAL', error: errUpdate.message }

  if (!diperbarui || diperbarui.length === 0) {
    // Kalah balapan dengan pengiriman/rilis/koreksi: tandai untuk guru saja.
    const catatanTanda = `${TANDA_SUSULAN} Jawaban offline siswa ini diterima setelah sesi ditutup dan menghasilkan nilai PG ${baru.nilai}, tetapi nilai sudah berubah status (dikirim/dirilis/dinilai) sehingga tidak diubah otomatis. Mohon ditinjau guru.`
    await db.from('nilai').update({ catatan_guru: tambahCatatan(nilaiRow.catatan_guru, catatanTanda) }).eq('id', nilaiRow.id)
    return { hasil: 'DITANDAI_UNTUK_GURU', alasan: 'ESSAY_SUDAH_DINILAI', nilaiTersimpan: nilaiRow.nilai ?? null, nilaiSeharusnya: baru.nilai }
  }

  return { hasil: 'DIPERBARUI', nilaiLama: nilaiRow.nilai ?? null, nilaiBaru: baru.nilai }
}
