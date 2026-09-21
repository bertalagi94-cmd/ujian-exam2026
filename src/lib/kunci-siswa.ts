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

type DbClient = ReturnType<typeof createAdminClient>

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
      // Error unique-violation (request lain sudah menulis nilai) sengaja diabaikan.
      await db.from('nilai').insert({
        id: generateId('NIL'),
        sesi_id: sesiId,
        nis,
        mapel_id: sesi.mapel_id,
        kelas: sesi.kelas,
        benar: 0,
        total: 0,
        nilai: 0,
        grade: 'E',
        lulus: false,
        kkm: mapel?.kkm ?? 75,
        timestamp: new Date().toISOString(),
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
