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
import { ambilSemuaBaris } from '@/lib/ambil-semua'

/**
 * Dilempar kalau data penilaian (kunci/kkm/jumlah soal) TIDAK bisa diambil
 * dengan benar dari database. Sengaja dilempar (bukan mengembalikan data
 * kosong) supaya cachedFetch TIDAK menyimpannya: hasil kosong yang ter-cache
 * 5 menit membuat semua siswa yang submit pada rentang itu dinilai 0.
 */
export class DataPenilaianGagalError extends Error {
  constructor(pesan: string) {
    super(pesan)
    this.name = 'DataPenilaianGagalError'
  }
}

/** Samakan format huruf jawaban/kunci (spasi & huruf kecil/besar). */
export function normalisasiHuruf(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

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
    //
    // FIX ARSITEKTUR KRITIS (soal yang dikerjakan siswa != kunci yang dipakai
    // menilai): sebelumnya fungsi ini SELALU mencari ulang paket_soal
    // berstatus DISETUJUI pada saat endpoint /selesai atau finalisasi paksa
    // dipanggil — bukan paket yang BENAR-BENAR diberikan ke siswa saat mulai
    // ujian (lihat validasi/route.ts). Kalau status paket berubah di antara
    // "siswa mulai ujian" dan "nilai dihitung" (mis. admin membatalkan
    // approval, atau — walau sudah dicegah cekSesiMapelKelasSudahMulai() di
    // hampir semua jalur — ada celah lain), kunci yang dipakai menilai bisa
    // berasal dari paket yang BERBEDA dari soal yang dikerjakan siswa,
    // sehingga soal_id tidak pernah cocok dan nilai siswa salah total
    // (biasanya jadi 0 walau jawabannya benar).
    //
    // FIX: sekarang membaca paket_soal_id yang SUDAH DI-SNAPSHOT ke
    // sesi_ujian oleh /api/siswa/ujian/validasi (lihat FIX di sana) saat
    // siswa pertama masuk sesi ini, dan SELALU memakai ID itu sepanjang
    // sesi — tidak pernah mencari ulang berdasarkan status DISETUJUI untuk
    // sesi yang sudah punya snapshot ini.
    //
    // FALLBACK KOMPATIBILITAS: sesi yang dibuat SEBELUM migrasi
    // 14_snapshot_paket_dan_transaksi_atomik.sql belum punya paket_soal_id
    // tersimpan (kolom masih NULL) — untuk sesi seperti itu (seharusnya
    // sudah SELESAI semua per saat migrasi dijalankan), tetap dipakai
    // resolusi lama supaya nilai yang sudah ada tidak rusak. Sesi BARU tidak
    // akan pernah lewat jalur fallback ini karena /validasi selalu mengisi
    // paket_soal_id begitu siswa pertama masuk.
    const { data: sesi, error: errSesi } = await db
      .from('sesi_ujian')
      .select('mapel_id, kelas, durasi, info_json, paket_soal_id')
      .eq('id', sesiId)
      .single()
    // PGRST116 = baris tidak ada (sesi memang tidak ada -> null, bukan galat).
    if (errSesi && errSesi.code !== 'PGRST116') {
      throw new DataPenilaianGagalError(`gagal membaca sesi_ujian: ${errSesi.message}`)
    }
    if (!sesi) return null

    let paketId: string | null = sesi.paket_soal_id ?? null
    let jumlahSoalPaket: number | null = null

    if (paketId) {
      const { data: paketRow, error: errPaket } = await db
        .from('paket_soal')
        .select('jumlah_soal')
        .eq('id', paketId)
        .maybeSingle()
      if (errPaket) {
        throw new DataPenilaianGagalError(`gagal membaca paket_soal: ${errPaket.message}`)
      }
      jumlahSoalPaket = paketRow?.jumlah_soal ?? null
    } else {
      // FALLBACK (sesi lama tanpa snapshot) — resolusi lama berdasarkan
      // status DISETUJUI saat ini. FIX: sesi.kelas = nama kelas, tapi
      // paket_soal.kelas_id = ID dari tabel kelas.
      const { data: kelasRow } = await db
        .from('kelas')
        .select('id')
        .eq('nama', String(sesi.kelas))
        .maybeSingle()
      const kelasId = kelasRow?.id ?? String(sesi.kelas)

      const { data: paketData } = await db
        .from('paket_soal')
        .select('id, jumlah_soal')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)
        .eq('status', 'DISETUJUI')
        .limit(1)
        .single()

      paketId = paketData?.id ?? null
      jumlahSoalPaket = paketData?.jumlah_soal ?? null
    }

    const [mapelRes, countRes, soalRes] = await Promise.all([
      db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
      db.from('soal')
        .select('*', { count: 'exact', head: true })
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketId ?? ''),
      // Ambil kunci SEMUA soal di paket ini sekaligus (bukan per-siswa
      // berdasarkan soal yang dia jawab) — supaya satu hasil cache ini bisa
      // dipakai untuk menghitung nilai siswa MANAPUN di sesi ini, bukan cuma
      // siswa yang memicu query pertama kali.
      // Dipaginasi (ambilSemuaBaris) karena PostgREST memotong diam-diam di
      // max_rows (default 1000).
      ambilSemuaBaris<{ id: string; kunci: string }>((dari, sampai) =>
        db.from('soal')
          .select('id, kunci')
          .eq('mapel_id', sesi.mapel_id)
          .eq('paket_id', paketId ?? '')
          .eq('status', 'DISETUJUI')
          .order('id', { ascending: true })
          .range(dari, sampai)
      ),
    ])

    // FIX (nilai 0 massal akibat error sesaat di-cache): sebelumnya error ketiga
    // query ini TIDAK dicek. Kalau salah satu gagal (timeout / lonjakan beban
    // saat banyak siswa submit), `data` bernilai null -> kunciMap {} -> hasil
    // kosong itu ikut di-cache 5 menit dan SEMUA siswa yang submit pada
    // rentang itu dinilai 0 secara permanen. Sekarang galat dilempar sehingga
    // cachedFetch tidak menyimpan apa pun; pemanggil memutuskan retry/gagal.
    // mapel: PGRST116 (baris tidak ada) tetap boleh -> kkm default 75.
    if (mapelRes.error && mapelRes.error.code !== 'PGRST116') {
      throw new DataPenilaianGagalError(`gagal membaca mapel: ${mapelRes.error.message}`)
    }
    if (countRes.error) {
      throw new DataPenilaianGagalError(`gagal menghitung soal paket: ${countRes.error.message}`)
    }
    if (soalRes.error) {
      throw new DataPenilaianGagalError(`gagal membaca kunci soal: ${soalRes.error.message}`)
    }

    const kunciMap: Record<string, string> = Object.fromEntries(
      soalRes.data.map(s => [s.id, normalisasiHuruf(s.kunci)])
    )
    const totalSoal = countRes.count ?? jumlahSoalPaket ?? 0

    // Pengaman anomali: paket diketahui & punya soal, tapi tidak satu pun kunci
    // terbaca. Hampir pasti pembacaan gagal/tidak lengkap, bukan kenyataan —
    // jangan dijadikan dasar menilai (dan jangan di-cache).
    if (paketId && totalSoal > 0 && Object.keys(kunciMap).length === 0) {
      throw new DataPenilaianGagalError(
        `kunci soal kosong untuk paket ${paketId} padahal totalSoal=${totalSoal}`
      )
    }

    return {
      sesi,
      kkm: mapelRes.data?.kkm ?? 75,
      totalSoal,
      kunciMap,
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
      // Bandingkan dalam format yang sama (kunci sudah dinormalisasi di
      // ambilDataSesiUntukPenilaian; jawaban dinormalisasi di sini) supaya
      // data lama/hasil restore berhuruf kecil atau berspasi tidak
      // otomatis dinilai salah.
      const jwb = normalisasiHuruf(j.jawaban)
      if (jwb && kunciMap[j.soal_id] === jwb) benar++
    }
  }

  const nilai = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilai >= 90 ? 'A' : nilai >= 80 ? 'B' : nilai >= 70 ? 'C' : nilai >= 60 ? 'D' : 'E'
  const lulus = nilai >= kkm

  return { benar, total, nilai, grade, lulus }
}
