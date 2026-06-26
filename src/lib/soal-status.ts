// src/lib/soal-status.ts
//
// Helper terpusat (SERVER-ONLY — pakai admin client) untuk resolve status_soal
// (status kesiapan paket soal) per kombinasi mapel_id + nama kelas. Jangan
// import file ini dari client component; untuk label/pesan yang aman dipakai
// di client, lihat src/lib/soal-status-shared.ts.
//
// Logikanya sama dengan yang sudah dipakai di
// src/app/api/admin/jadwal/route.ts dan src/lib/rangkuman.ts:
//
//   - kelas_id di tabel paket_soal SELALU berupa id asli tabel kelas
//     (misal "KLS_xxx"), BUKAN nama kelas.
//   - jadwal.kelas (dan sesi_ujian.kelas) menyimpan NAMA kelas (misal "10").
//   - jadi kita perlu resolve kelas_id -> nama kelas dulu, baru dicocokkan.
//   - kalau ada beberapa paket_soal untuk kombinasi mapel+kelas yang sama,
//     ambil status dengan prioritas tertinggi: DISETUJUI > MENUNGGU > DITOLAK > DRAFT.
//
// File ini dibuat agar logika "apakah soal sudah siap?" tidak ditulis ulang
// di banyak tempat (rawan tidak sinkron / bug saat salah satu tempat lupa
// diupdate).

import { createAdminClient } from '@/lib/supabase'
import type { StatusSoal } from '@/lib/soal-status-shared'

export type { StatusSoal }
export { isStatusSoalSiap, labelStatusSoal, pesanStatusSoal } from '@/lib/soal-status-shared'

const STATUS_PRIORITY: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DITOLAK: 2, DRAFT: 1 }

/**
 * Hitung status_soal untuk sekumpulan kombinasi (mapel_id, kelas) sekaligus.
 * Lebih efisien daripada query satu-satu kalau dipakai untuk list jadwal.
 *
 * @param items daftar kombinasi { mapel_id, kelas } yang ingin dicek.
 * @returns map dengan key `${mapel_id}__${kelas}` -> StatusSoal
 */
export async function computeStatusSoalMap(
  items: { mapel_id: string; kelas: string }[]
): Promise<Record<string, StatusSoal>> {
  const result: Record<string, StatusSoal> = {}
  const mapelIds = [...new Set(items.map(i => i.mapel_id).filter(Boolean))]
  if (mapelIds.length === 0) return result

  const db = createAdminClient()

  // Ambil SEMUA kelas (tanpa filter) untuk map id -> nama yang lengkap.
  const { data: kelasListRaw } = await (db as any).from('kelas').select('id, nama')
  const kelasList = (kelasListRaw ?? []) as { id: string; nama: string }[]
  const idToNamaKelas = Object.fromEntries(kelasList.map(k => [k.id, String(k.nama)]))

  const { data: paketListRaw } = await db
    .from('paket_soal')
    .select('mapel_id, kelas_id, status')
    .in('mapel_id', mapelIds)

  const paketList = (paketListRaw ?? []) as { mapel_id: string; kelas_id: string; status: string }[]

  for (const p of paketList) {
    const namaKelasPaket = idToNamaKelas[p.kelas_id] ?? p.kelas_id
    const key = `${p.mapel_id}__${namaKelasPaket}`
    const existing = result[key]
    if (!existing || (STATUS_PRIORITY[p.status] ?? 0) > (STATUS_PRIORITY[existing] ?? 0)) {
      result[key] = (p.status as StatusSoal) ?? 'BELUM_ADA'
    }
  }

  // Pastikan semua kombinasi yang diminta punya entry (default BELUM_ADA)
  for (const item of items) {
    const key = `${item.mapel_id}__${item.kelas}`
    if (!result[key]) result[key] = 'BELUM_ADA'
  }

  return result
}

/**
 * Versi single-lookup, untuk dipakai saat hanya perlu cek satu kombinasi
 * mapel_id + kelas (misal saat pengawas akan membuka satu sesi ujian).
 */
export async function getStatusSoal(mapelId: string, kelas: string): Promise<StatusSoal> {
  const map = await computeStatusSoalMap([{ mapel_id: mapelId, kelas }])
  return map[`${mapelId}__${kelas}`] ?? 'BELUM_ADA'
}
