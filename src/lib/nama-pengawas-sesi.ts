// src/lib/nama-pengawas-sesi.ts
//
// ── NAMA PENGAWAS YANG TAMPIL DI LAYAR ESSAY SISWA ──────────────────────────
// BUG SEBELUMNYA: layar info essay (essay/info) dan isi amplop offline
// (essay/amplop) selalu mengambil nama pengawas dari `jadwal.pengawas`.
// Untuk sesi RUANG KHUSUS (lab) itu adalah guru kelas, bukan pengawas ruang,
// sehingga siswa lab yang butuh kode darurat essay diarahkan ke orang yang
// salah. Hal yang sama berlaku untuk sesi susulan yang diambil-alih admin.
//
// ATURAN: sama persis dengan `verifySesiOwnership` (sesi-ownership.ts) dan
// `sesi-belum-ditutup.ts` — kalau sesi dibuka admin dan punya
// `info_json.pengawas_susulan` (sesi ruang khusus selalu begini, lihat
// ruang-khusus.ts), pengawasnya adalah orang itu. Selain itu: `jadwal.pengawas`.

import type { tenantDb } from '@/lib/tenant'

type Db = ReturnType<typeof tenantDb>

export interface SesiUntukNamaPengawas {
  jadwal_id?: string | null
  info_json?: Record<string, any> | null
}

/** Username pengawas yang bertanggung jawab atas sesi ini (null kalau tidak ada). */
export async function usernamePengawasSesi(
  db: Db,
  sesi: SesiUntukNamaPengawas
): Promise<string | null> {
  const info = sesi.info_json ?? {}
  if (info.dibuka_oleh_admin && info.pengawas_susulan) {
    return String(info.pengawas_susulan)
  }
  if (!sesi.jadwal_id) return null
  const { data: jadwal } = await db
    .from('jadwal').select('pengawas').eq('id', sesi.jadwal_id).single()
  return jadwal?.pengawas ? String(jadwal.pengawas) : null
}

/** Nama tampilan pengawas sesi; jatuh ke username kalau nama tidak ditemukan. */
export async function namaPengawasSesi(
  db: Db,
  sesi: SesiUntukNamaPengawas
): Promise<string | null> {
  const username = await usernamePengawasSesi(db, sesi)
  if (!username) return null
  const { data: guru } = await db
    .from('users').select('nama').eq('username', username).single()
  return guru?.nama ?? username
}
