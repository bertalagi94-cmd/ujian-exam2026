// src/lib/target-siswa-sesi.ts
//
// Menentukan daftar siswa yang menjadi PESERTA sebuah sesi ujian, dipakai
// bersama oleh:
//   - GET /api/pengawas/sesi/[id]/siswa       (daftar + status untuk pengawas)
//   - GET /api/pengawas/sesi/[id]/kode-reset  (kode R1/R2/R3 untuk pengawas)
// supaya kedua endpoint SELALU melihat daftar yang sama.
//
// Logika dipindahkan apa adanya dari route daftar siswa:
//   - sesi susulan (is_darurat = true, siswa_diizinkan tidak kosong):
//       target = siswa_diizinkan
//   - sesi reguler: target = semua siswa AKTIF di kelas sesi
//   - mapel khusus agama (mapel.agama terisi, mis. PAI/PAK): target hanya siswa
//     seagama (siswa tanpa agama terisi tetap dihitung) — lihat src/lib/agama.ts
//   - siswa yang sudah punya baris siswa_ujian tapi di luar target (mis. pindah
//     kelas setelah sesi dibuka, atau beda agama tapi terlanjur login) tetap
//     disertakan supaya tidak hilang dari pantauan.

import type { createAdminClient } from '@/lib/supabase'
import { ambilAgamaMapel, saringSiswaSeagama } from '@/lib/agama'
import { nisPenempatanRuangJadwal, petaPenempatanJadwal } from '@/lib/ruang-khusus'

type DbClient = ReturnType<typeof createAdminClient>

export interface SiswaTarget { nis: string; nama: string; kelas: string }

export interface InfoSesiTarget {
  mapel_id?: string | null
  kelas: string | null
  is_darurat: boolean | null
  siswa_diizinkan: string[] | null
  // Ruang khusus (migrasi 65). Kalau diisi, target ikut aturan ruang:
  //   - sesi RUANG   : target = siswa yang ditempatkan di ruang itu;
  //   - sesi KELAS   : siswa yang ditempatkan di ruang khusus TIDAK dihitung
  //                    (mereka lepas dari kelas dan diawasi pengawas ruang).
  jadwal_id?: string | null
  ruang_khusus_id?: string | null
}

export async function ambilTargetSiswaSesi(
  db: DbClient,
  sesi: InfoSesiTarget,
  nisSudahLogin: string[]
): Promise<SiswaTarget[]> {
  let targetSiswa: SiswaTarget[] = []
  if (sesi.ruang_khusus_id && sesi.jadwal_id) {
    const nisRuang = await nisPenempatanRuangJadwal(db, sesi.ruang_khusus_id, sesi.jadwal_id)
    if (nisRuang.length > 0) {
      const { data } = await db.from('siswa').select('nis, nama, kelas').in('nis', nisRuang)
      targetSiswa = data ?? []
    }
  } else if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    const { data } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .in('nis', sesi.siswa_diizinkan)
    targetSiswa = data ?? []
  } else if (sesi.kelas) {
    const { data } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .eq('kelas', sesi.kelas)
      .eq('status', 'AKTIF')
    targetSiswa = data ?? []
    // Siswa yang sudah dipindah ke ruang khusus tidak lagi menjadi target kelas.
    if (sesi.jadwal_id && !sesi.is_darurat) {
      const dipindah = await petaPenempatanJadwal(db, sesi.jadwal_id)
      if (dipindah.size > 0) targetSiswa = targetSiswa.filter(s => !dipindah.has(s.nis))
    }
  }

  // Mapel khusus agama: buang siswa yang beda agama dari target.
  const agamaMapel = await ambilAgamaMapel(db, sesi.mapel_id)
  if (agamaMapel) targetSiswa = await saringSiswaSeagama(db, targetSiswa, agamaMapel)

  const targetNisSet = new Set(targetSiswa.map(s => s.nis))
  const extraNis = nisSudahLogin.filter(nis => !targetNisSet.has(nis))
  if (extraNis.length > 0) {
    const { data: extraSiswa } = await db
      .from('siswa')
      .select('nis, nama, kelas')
      .in('nis', extraNis)
    targetSiswa = targetSiswa.concat(extraSiswa ?? [])
  }

  return targetSiswa
}
