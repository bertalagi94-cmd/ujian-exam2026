// src/lib/penilaian-ujian.ts
//
// Modul bersama untuk logika penilaian ujian yang SEBELUMNYA terduplikasi
// persis sama di 3 tempat:
//   - src/app/api/siswa/ujian/selesai/route.ts (siswa submit sendiri)
//   - src/lib/finalisasi-nilai.ts (fallback saat sesi ditutup paksa)
//   - src/lib/hitung-nilai.ts (kode mati, tidak pernah dipanggil — sudah dihapus)
//
// Tujuan modul ini murni supaya rumus penilaian (kkm, kunci jawaban, grade,
// lulus/tidak) HANYA ada di satu tempat — tidak ada perubahan logika sama
// sekali dibanding versi sebelumnya, hanya dipindahkan.

import { SupabaseClient } from '@supabase/supabase-js'
import { cachedFetch } from '@/lib/cache'

export interface DataSesiUntukPenilaian {
  sesi: { mapel_id: string; kelas: string; durasi?: number; info_json?: Record<string, unknown> }
  kkm: number
  totalSoal: number
  kunciMap: Record<string, string>
}

/**
 * Ambil data yang dibutuhkan untuk menilai ujian pada suatu sesi: kkm mapel,
 * kunci jawaban semua soal di paket, dan jumlah total soal.
 *
 * Di-cache 5 menit per sesi_id (key: `selesai:sesi:${sesiId}`) karena
 * datanya sama untuk semua siswa di sesi yang sama dan tidak berubah selama
 * ujian berjalan — cache ini boleh dipakai bersama oleh siapa pun yang
 * memanggil endpoint ini untuk sesi yang sama, TERMASUK siswa yang berbeda.
 *
 * PENTING: cache ini HANYA untuk data statis (kkm, kunci, jumlah soal) —
 * BUKAN untuk status sesi (BERJALAN/SELESAI). Status sesi harus selalu
 * di-query langsung tanpa cache di endpoint yang mengeceknya (lihat
 * sync/route.ts, mode-pengawas/tutup/route.ts, tutup-paksa/route.ts) supaya
 * tidak ada risiko cache basi lintas-instance Vercel saat sesi ditutup.
 */
export async function ambilDataSesiUntukPenilaian(
  db: SupabaseClient<any>,
  sesiId: string
): Promise<DataSesiUntukPenilaian | null> {
  return cachedFetch(`selesai:sesi:${sesiId}`, 300, async () => {
    // FIX (fitur essay): tambah info_json ke select supaya caller (terutama
    // selesai/route.ts) bisa tahu apakah sesi ini punya essay
    // (info_json.essay_aktif) tanpa query terpisah — data ini statis untuk
    // sesi yang sama jadi aman ikut di-cache 5 menit bersama field lain.
    const { data: sesi } = await db
      .from('sesi_ujian')
      .select('mapel_id, kelas, durasi, info_json')
      .eq('id', sesiId)
      .single()
    if (!sesi) return null

    // FIX: sesi.kelas = nama kelas, tapi paket_soal.kelas_id = ID dari tabel kelas
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const [{ data: mapel }, { data: paketData }] = await Promise.all([
      db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
      db.from('paket_soal')
        .select('id, jumlah_soal')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)   // ← FIX: pakai kelasId bukan sesi.kelas
        .eq('status', 'DISETUJUI')
        .limit(1)
        .single(),
    ])

    const [{ count: totalSoalCount }, { data: soalList }] = await Promise.all([
      db.from('soal')
        .select('*', { count: 'exact', head: true })
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketData?.id ?? ''),
      // Ambil kunci SEMUA soal di paket ini sekaligus (bukan per-siswa
      // berdasarkan soal yang dia jawab) — supaya satu hasil cache ini bisa
      // dipakai untuk menghitung nilai siswa MANAPUN di sesi ini, bukan cuma
      // siswa yang memicu query pertama kali.
      db.from('soal')
        .select('id, kunci')
        .eq('mapel_id', sesi.mapel_id)
        .eq('paket_id', paketData?.id ?? '')
        .eq('status', 'DISETUJUI'),
    ])

    return {
      sesi,
      kkm: mapel?.kkm ?? 75,
      totalSoal: totalSoalCount ?? paketData?.jumlah_soal ?? 0,
      kunciMap: Object.fromEntries((soalList ?? []).map((s: { id: string; kunci: string }) => [s.id, s.kunci])) as Record<string, string>,
    }
  })
}

export interface HasilPenilaian {
  benar: number
  total: number
  nilai: number
  grade: string
  lulus: boolean
}

/**
 * Hitung benar/total/nilai/grade/lulus dari jawaban siswa + kunci jawaban +
 * kkm. Fungsi murni (tidak menyentuh database) — rumus IDENTIK dengan yang
 * sebelumnya ada inline di selesai/route.ts dan finalisasi-nilai.ts.
 */
export function hitungHasilPenilaian(
  jawabanSiswa: { soal_id: string; jawaban: string }[] | null | undefined,
  kunciMap: Record<string, string>,
  totalSoal: number,
  kkm: number
): HasilPenilaian {
  let benar = 0
  const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)

  if (jawabanSiswa?.length) {
    for (const j of jawabanSiswa) {
      if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
    }
  }

  const nilai = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilai >= 90 ? 'A' : nilai >= 80 ? 'B' : nilai >= 70 ? 'C' : nilai >= 60 ? 'D' : 'E'
  const lulus = nilai >= kkm

  return { benar, total, nilai, grade, lulus }
}
