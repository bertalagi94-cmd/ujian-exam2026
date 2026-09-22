// src/lib/kunci-siswa.ts
//
// Tindakan LANJUTAN setelah siswa berstatus TERKUNCI (pelanggaran melebihi
// jumlah reset yang diizinkan). Perubahan status TERKUNCI itu sendiri
// dilakukan atomik di dalam RPC catat_pelanggaran_atomik (migrasi 24);
// fungsi ini hanya menuntaskan sisanya: nilai 0 + waktu selesai.
//
// Logikanya dipindahkan apa adanya dari
// src/app/api/pengawas/sesi/[id]/reset-siswa/route.ts (versi lama) supaya
// perilaku bisnis tidak berubah — hanya SIAPA yang memicunya: sekarang server
// otomatis saat pelanggaran ke-(N+1), bukan bergantung pada pengawas menekan
// tombol.
//
// Idempoten: aman dipanggil berulang (retry / event ganda).
//
// PENTING (bug lama yang sudah diperbaiki, jangan diulang): JANGAN mengubah
// siswa_ujian.status menjadi 'SELESAI' di sini. Status harus tetap
// 'TERKUNCI' supaya polling client dan guard di /sync tetap menolak siswa ini.

import { generateId } from '@/lib/utils'
import type { createAdminClient } from '@/lib/supabase'
import { ambilDataSesiUntukPenilaian, hitungHasilPenilaian } from '@/lib/penilaian-ujian'

type DbClient = ReturnType<typeof createAdminClient>

// P0 FIX (audit brief "nilai 0 tapi rincian ada jawaban benar"): sebelumnya
// baris `nilai` untuk siswa terkunci permanen SELALU ditulis benar=0,
// total=0 — padahal jawaban siswa (tabel `jawaban`) TIDAK PERNAH dihapus,
// dan halaman rincian hasil (/api/siswa/nilai/[id]) menghitung ULANG
// benar/salah PER SOAL langsung dari situ. Akibatnya siswa melihat badge
// "Benar" di beberapa nomor soal padahal ringkasan menyatakan 0/0 — sangat
// membingungkan dan terlihat seperti data korup, padahal sebenarnya
// keduanya "benar" menurut definisi masing-masing (ringkasan sengaja
// dipaksa 0 karena pelanggaran, rincian menunjukkan jawaban asli apa
// adanya untuk keperluan audit guru/admin).
//
// FIX: hitung benar/total YANG SEBENARNYA (pakai modul penilaian yang sama
// dengan alur submit normal), simpan apa adanya di kolom benar/total, dan
// tulis catatan_guru yang menjelaskan kenapa nilai akhir tetap 0 meskipun
// ada jawaban benar. `nilai`/`grade`/`lulus` TETAP dipaksa 0/E/false sesuai
// aturan bisnis (pelanggaran → gugur), TIDAK berubah — hanya benar/total
// dan catatan yang ditambahkan supaya tidak lagi tampak seperti data yang
// saling bertentangan.
export async function tuntaskanSiswaTerkunci(db: DbClient, sesiId: string, nis: string): Promise<void> {
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .maybeSingle()

  if (!nilaiExist) {
    const { data: sesi } = await db
      .from('sesi_ujian')
      .select('mapel_id, kelas')
      .eq('id', sesiId)
      .single()

    if (sesi) {
      const { data: mapel } = await db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single()
      const kkm = mapel?.kkm ?? 75

      // Hitung benar/total ASLI dari jawaban yang sempat tersimpan, murni
      // untuk transparansi/audit — tidak memengaruhi nilai akhir (tetap 0
      // karena pelanggaran).
      let benarAsli = 0
      let totalAsli = 0
      try {
        const sesiCache = await ambilDataSesiUntukPenilaian(db, sesiId)
        if (sesiCache) {
          const { data: jawabanSiswa } = await db
            .from('jawaban')
            .select('soal_id, jawaban')
            .eq('sesi_id', sesiId)
            .eq('nis', nis)
          const hasil = hitungHasilPenilaian(jawabanSiswa, sesiCache.kunciMap, sesiCache.totalSoal, kkm)
          benarAsli = hasil.benar
          totalAsli = hasil.total
        }
      } catch (e) {
        // Kalau perhitungan gagal, jangan sampai menggagalkan penguncian
        // siswa (bagian paling kritis) — cukup fallback ke 0/0 seperti
        // perilaku lama, tetap aman secara aturan bisnis.
        console.error('[kunci-siswa] gagal menghitung benar/total asli untuk transparansi:', e instanceof Error ? e.message : e)
      }

      // Error unique-violation (request lain sudah menulis nilai) sengaja diabaikan.
      await db.from('nilai').insert({
        id: generateId('NIL'),
        sesi_id: sesiId,
        nis,
        mapel_id: sesi.mapel_id,
        kelas: sesi.kelas,
        benar: benarAsli,
        total: totalAsli,
        nilai: 0,
        grade: 'E',
        lulus: false,
        kkm,
        timestamp: new Date().toISOString(),
        catatan_guru: totalAsli > 0
          ? `Ujian dihentikan otomatis karena pelanggaran melebihi batas reset yang diizinkan. Nilai akhir ditetapkan 0 sesuai aturan, meskipun tercatat ${benarAsli} dari ${totalAsli} jawaban benar sebelum ujian dihentikan. Jawaban asli tetap disimpan untuk keperluan audit.`
          : 'Ujian dihentikan otomatis karena pelanggaran melebihi batas reset yang diizinkan. Nilai akhir ditetapkan 0 sesuai aturan.',
      })
    }
  }

  // Catat waktu selesai tanpa menyentuh status TERKUNCI.
  await db
    .from('siswa_ujian')
    .update({ waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .is('waktu_selesai', null)
}
