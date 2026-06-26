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

// Normalisasi nama kelas untuk KEPERLUAN PENCOCOKAN SAJA (bukan untuk
// ditampilkan). Data nama kelas kadang punya selisih spasi di awal/akhir atau
// beda kapitalisasi antara tabel `kelas`, `jadwal.kelas`, dan input manual —
// tanpa normalisasi ini, kombinasi yang SEBENARNYA sama bisa gagal match dan
// berakhir dianggap "BELUM_ADA" padahal soalnya sudah ada.
function normalizeKelas(v: unknown): string {
  return String(v ?? '').trim().toUpperCase()
}

/**
 * Bangun key lookup yang konsisten dengan key yang dipakai di dalam
 * computeStatusSoalDetailMap / computeStatusSoalMap. WAJIB dipakai oleh
 * pemanggil saat membaca hasil map (jangan bangun key manual sendiri),
 * supaya tidak gagal cocok akibat selisih spasi/kapitalisasi nama kelas.
 */
export function buildStatusSoalKey(mapelId: string, kelas: string): string {
  return `${mapelId}__${normalizeKelas(kelas)}`
}

export type StatusSoalDetail = {
  status: StatusSoal
  /**
   * Nama guru pemilik paket soal untuk kombinasi mapel+kelas ini.
   * Kalau ada lebih dari satu guru yang berkontribusi pada status tertinggi
   * (misal team-teaching), nama-nama digabung dengan ", " (contoh:
   * "Budi Santoso, Siti Aminah"). null kalau tidak ada paket_soal sama sekali
   * (status BELUM_ADA tanpa guru_id) atau guru_id tidak diisi.
   */
  namaGuru: string | null
}

/**
 * Hitung status_soal (+ nama guru pembuat soal) untuk sekumpulan kombinasi
 * (mapel_id, kelas) sekaligus. Lebih efisien daripada query satu-satu kalau
 * dipakai untuk list jadwal.
 *
 * Nama guru disertakan agar UI (mode pengawas, baik untuk akun GURU maupun
 * PENGAWAS/ADMIN) bisa menampilkan pesan seperti "Soal belum dibuat. Nama
 * Guru : (Nama Guru)" tanpa perlu request tambahan.
 *
 * @param items daftar kombinasi { mapel_id, kelas } yang ingin dicek.
 * @returns map dengan key `${mapel_id}__${kelas}` -> StatusSoalDetail
 */
export async function computeStatusSoalDetailMap(
  items: { mapel_id: string; kelas: string }[]
): Promise<Record<string, StatusSoalDetail>> {
  const result: Record<string, StatusSoalDetail> = {}
  const mapelIds = [...new Set(items.map(i => i.mapel_id).filter(Boolean))]
  if (mapelIds.length === 0) return result

  const db = createAdminClient()

  // Ambil SEMUA kelas (tanpa filter) untuk map id -> nama yang lengkap.
  const { data: kelasListRaw } = await (db as any).from('kelas').select('id, nama')
  const kelasList = (kelasListRaw ?? []) as { id: string; nama: string }[]
  const idToNamaKelas = Object.fromEntries(kelasList.map(k => [k.id, String(k.nama)]))

  const { data: paketListRaw } = await db
    .from('paket_soal')
    .select('mapel_id, kelas_id, status, guru_id')
    .in('mapel_id', mapelIds)

  const paketList = (paketListRaw ?? []) as { mapel_id: string; kelas_id: string; status: string; guru_id: string | null }[]

  // Resolve guru_id -> nama guru (sekali query untuk semua guru yang muncul).
  const guruIds = [...new Set(paketList.map(p => p.guru_id).filter(Boolean))] as string[]
  let idToNamaGuru: Record<string, string> = {}
  if (guruIds.length > 0) {
    const { data: guruListRaw } = await db
      .from('users')
      .select('username, nama')
      .in('username', guruIds)
    idToNamaGuru = Object.fromEntries(((guruListRaw ?? []) as { username: string; nama: string }[]).map(g => [g.username, g.nama]))
  }

  // Catatan: satu kombinasi mapel+kelas bisa diajar oleh LEBIH DARI SATU guru
  // (misal team-teaching, atau guru pengganti yang juga membuat paket_soal
  // sendiri). Jadi kita tidak boleh asal menyimpan SATU guru_id terakhir yang
  // match status tertinggi — kita kumpulkan dulu SEMUA nama guru yang
  // berkontribusi pada status tertinggi tersebut, baru digabung jadi satu
  // string (dipisah ", ") untuk ditampilkan di pesan.
  const namaGuruByKeyStatus: Record<string, Set<string>> = {} // key: `${mapelKelasKey}__${status}`
  const bestStatusByKey: Record<string, StatusSoal> = {}

  for (const p of paketList) {
    const namaKelasPaket = idToNamaKelas[p.kelas_id] ?? p.kelas_id
    const key = buildStatusSoalKey(p.mapel_id, namaKelasPaket)
    const status = (p.status as StatusSoal) ?? 'BELUM_ADA'

    const namaGuru = p.guru_id ? (idToNamaGuru[p.guru_id] ?? p.guru_id) : null
    if (namaGuru) {
      const statusKey = `${key}__${status}`
      if (!namaGuruByKeyStatus[statusKey]) namaGuruByKeyStatus[statusKey] = new Set()
      namaGuruByKeyStatus[statusKey].add(namaGuru)
    }

    const existingBest = bestStatusByKey[key]
    if (!existingBest || (STATUS_PRIORITY[status] ?? 0) > (STATUS_PRIORITY[existingBest] ?? 0)) {
      bestStatusByKey[key] = status
    }
  }

  for (const [key, status] of Object.entries(bestStatusByKey)) {
    const namaGuruSet = namaGuruByKeyStatus[`${key}__${status}`]
    result[key] = {
      status,
      namaGuru: namaGuruSet && namaGuruSet.size > 0 ? [...namaGuruSet].join(', ') : null,
    }
  }

  // Pastikan semua kombinasi yang diminta punya entry (default BELUM_ADA).
  for (const item of items) {
    const key = buildStatusSoalKey(item.mapel_id, item.kelas)
    if (!result[key]) result[key] = { status: 'BELUM_ADA', namaGuru: null }
  }

  // ── Fallback nama guru dari PENUGASAN (tabel `mapel`), bukan dari paket_soal ──
  // Kalau suatu kombinasi mapel+kelas belum punya paket_soal sama sekali (atau
  // paket_soal-nya tidak mengisi guru_id), kita tidak boleh menampilkan "-".
  // Guru yang BERTUGAS mengajar mapel itu tetap bisa diketahui dari
  // mapel.guru_id (kolom penugasan) + mapel.kelas_list (daftar kelas yang
  // diampu, format "10,11,12"). Ini berlaku untuk SEMUA status, bukan hanya
  // BELUM_ADA, supaya konsisten — tapi prioritas tetap ke namaGuru pemilik
  // paket_soal kalau itu sudah ada.
  const keysButuhFallback = Object.entries(result)
    .filter(([, v]) => !v.namaGuru)
    .map(([k]) => k)

  if (keysButuhFallback.length > 0) {
    const { data: mapelRowsRaw } = await db
      .from('mapel')
      .select('id, guru_id, kelas_list')
      .in('id', mapelIds)
    const mapelRows = (mapelRowsRaw ?? []) as { id: string; guru_id: string | null; kelas_list: string | null }[]
    const mapelById = Object.fromEntries(mapelRows.map(m => [m.id, m]))

    const guruIdPenugasan = [...new Set(mapelRows.map(m => m.guru_id).filter(Boolean))] as string[]
    const guruIdBelumDiketahui = guruIdPenugasan.filter(g => !idToNamaGuru[g])
    if (guruIdBelumDiketahui.length > 0) {
      const { data: guruTambahanRaw } = await db
        .from('users')
        .select('username, nama')
        .in('username', guruIdBelumDiketahui)
      for (const g of (guruTambahanRaw ?? []) as { username: string; nama: string }[]) {
        idToNamaGuru[g.username] = g.nama
      }
    }

    for (const item of items) {
      const key = buildStatusSoalKey(item.mapel_id, item.kelas)
      if (result[key]?.namaGuru) continue // sudah ada dari paket_soal, jangan timpa

      const mapelRow = mapelById[item.mapel_id]
      if (!mapelRow?.guru_id) continue

      const kelasDiampu = (mapelRow.kelas_list ?? '')
        .split(',')
        .map(k => normalizeKelas(k))
        .filter(Boolean)
      if (!kelasDiampu.includes(normalizeKelas(item.kelas))) continue

      result[key].namaGuru = idToNamaGuru[mapelRow.guru_id] ?? mapelRow.guru_id
    }
  }

  return result
}

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
  const detail = await computeStatusSoalDetailMap(items)
  return Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.status]))
}

/**
 * Versi single-lookup, untuk dipakai saat hanya perlu cek satu kombinasi
 * mapel_id + kelas (misal saat pengawas akan membuka satu sesi ujian).
 */
export async function getStatusSoal(mapelId: string, kelas: string): Promise<StatusSoal> {
  const map = await computeStatusSoalMap([{ mapel_id: mapelId, kelas }])
  return map[buildStatusSoalKey(mapelId, kelas)] ?? 'BELUM_ADA'
}

/**
 * Versi single-lookup yang juga mengembalikan nama guru pemilik paket soal.
 * Dipakai saat akan menampilkan pesan error yang menyebut nama guru (misal
 * saat akun GURU/PENGAWAS mencoba membuka sesi tapi soal belum siap).
 */
export async function getStatusSoalDetail(mapelId: string, kelas: string): Promise<StatusSoalDetail> {
  const map = await computeStatusSoalDetailMap([{ mapel_id: mapelId, kelas }])
  return map[buildStatusSoalKey(mapelId, kelas)] ?? { status: 'BELUM_ADA', namaGuru: null }
}
