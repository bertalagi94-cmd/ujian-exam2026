// src/lib/sesi-kelas.ts
//
// ── ANTI-TABRAKAN LEVEL KELAS ───────────────────────────────────────────────
// Sebelumnya, pengecekan anti-tabrakan saat membuka sesi ujian hanya
// mencakup:
//   1. Per-jadwal: jadwal yang sama tidak boleh punya 2 sesi BERJALAN.
//   2. Per-pengawas: satu guru tidak boleh mengawasi 2 sesi BERJALAN sekaligus.
//
// Yang TIDAK pernah dicek: apakah KELAS yang sama sudah punya sesi BERJALAN
// dari JADWAL LAIN (mapel lain / pengawas lain). Akibatnya, jadwal baru atau
// jadwal susulan untuk kelas yang sama bisa dibuka sesinya bersamaan dengan
// sesi yang sedang berjalan di kelas itu — dua ujian aktif sekaligus untuk
// satu kelas, yang bisa membingungkan siswa atau dimanfaatkan untuk
// mengerjakan 2 ujian sekaligus di tab/device berbeda.
//
// Fungsi ini dipakai oleh SEMUA endpoint yang bisa membuka sesi ujian:
//   - POST /api/guru/mode-pengawas   (buka sesi reguler oleh pengawas)
//   - POST /api/guru/susulan          (susulan oleh pengawas asli)
//   - POST /api/admin/susulan         (susulan dibuka admin untuk guru lain)
//
// Aturan: TOLAK OTOMATIS — kalau kelas yang sama sudah punya sesi BERJALAN
// dari jadwal lain (mapel apa pun, pengawas siapa pun), sesi baru tidak bisa
// dibuka sampai sesi yang sedang berjalan itu ditutup.

import { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

export interface SesiBentrokKelas {
  sesiId: string
  kodeSesi: string
  jadwalId: string
  mapelId: string
  namaMapel: string | null
}

/**
 * Cek apakah kelas `kelasNama` sudah punya sesi ujian BERJALAN dari jadwal
 * LAIN (jadwal_id != jadwalIdBaru). Kembalikan info sesi yang bentrok kalau
 * ada, atau `null` kalau aman untuk membuka sesi baru.
 */
export async function cekSesiBentrokKelas(
  db: DbClient,
  kelasNama: string,
  jadwalIdBaru: string
): Promise<SesiBentrokKelas | null> {
  const { data: sesiBerjalanKelas } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi, jadwal_id, mapel_id')
    .eq('kelas', String(kelasNama))
    .eq('status', 'BERJALAN')
    .neq('jadwal_id', jadwalIdBaru)
    .limit(1)
    .maybeSingle()

  if (!sesiBerjalanKelas) return null

  const { data: mapel } = await db
    .from('mapel')
    .select('nama')
    .eq('id', sesiBerjalanKelas.mapel_id)
    .maybeSingle()

  return {
    sesiId: sesiBerjalanKelas.id,
    kodeSesi: sesiBerjalanKelas.kode_sesi,
    jadwalId: sesiBerjalanKelas.jadwal_id,
    mapelId: sesiBerjalanKelas.mapel_id,
    namaMapel: mapel?.nama ?? null,
  }
}

/** Pesan error standar untuk response 409 saat sesi bentrok di level kelas. */
export function pesanBentrokKelas(kelasNama: string, bentrok: SesiBentrokKelas): string {
  return `Kelas ${kelasNama} masih memiliki sesi ujian lain yang sedang berjalan` +
    `${bentrok.namaMapel ? ` (${bentrok.namaMapel})` : ''}. ` +
    `Tutup sesi tersebut terlebih dahulu sebelum membuka sesi baru untuk kelas ini, ` +
    `agar tidak ada 2 ujian aktif bersamaan di kelas yang sama.`
}
