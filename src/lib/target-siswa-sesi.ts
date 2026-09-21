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
//   - siswa yang sudah punya baris siswa_ujian tapi di luar target (mis. pindah
//     kelas setelah sesi dibuka) tetap disertakan supaya tidak hilang dari
//     pantauan.

import type { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

export interface SiswaTarget { nis: string; nama: string; kelas: string }

export interface InfoSesiTarget {
  kelas: string | null
  is_darurat: boolean | null
  siswa_diizinkan: string[] | null
}

export async function ambilTargetSiswaSesi(
  db: DbClient,
  sesi: InfoSesiTarget,
  nisSudahLogin: string[]
): Promise<SiswaTarget[]> {
  let targetSiswa: SiswaTarget[] = []
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
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
  }

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
