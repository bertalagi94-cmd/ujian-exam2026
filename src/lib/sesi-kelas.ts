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

// ── KUNCI BANK SOAL SETELAH SESI DIMULAI (PG & ESSAY) ───────────────────────
//
// Masalah yang diperbaiki: soal PG dan soal essay masing-masing punya bank
// sendiri per mapel+kelas (paket_soal / paket_essay), dan keduanya BOLEH
// diajukan/divalidasi terpisah (lihat gabungKirim.ts). Sebelum ini, tidak
// ada satupun titik yang mengecek apakah sesi ujian untuk mapel+kelas
// tersebut SUDAH PERNAH DIBUKA (sedang berjalan atau sudah selesai) sebelum
// guru menambah/mengubah/menghapus paket maupun soal di dalamnya.
//
// Akibatnya guru bisa, misalnya, hanya membuat paket PG (tanpa essay),
// menjalankan ujian sampai selesai dengan hanya PG itu, lalu BARU SETELAH
// itu menambahkan soal essay (atau membuat paket essay baru) untuk
// mapel+kelas yang sama — padahal siswa sudah mengerjakan ujian tanpa
// essay tersebut, sehingga soal yang ditambah belakangan tidak pernah
// relevan/terpakai dan datanya jadi tidak konsisten dengan apa yang
// sebenarnya diujikan.
//
// Fungsi di bawah ini dipakai oleh SEMUA endpoint yang membuat/mengubah/
// menghapus paket_soal, paket_essay, soal, dan soal_essay untuk menolak
// aksi tersebut begitu sesi_ujian untuk kombinasi mapel_id+kelas_id itu
// berstatus BERJALAN (sedang berlangsung) atau SELESAI (sudah pernah
// berlangsung).

export interface SesiMapelKelasInfo {
  sesiId: string
  kodeSesi: string | null
  status: string
}

/**
 * Cek apakah sesi ujian untuk kombinasi `mapelId` + `kelasId` SUDAH PERNAH
 * dibuka (status BERJALAN atau SELESAI). Kembalikan info sesi paling baru
 * kalau ada, atau `null` kalau belum pernah ada sesi ujian sama sekali
 * (aman untuk menambah/mengubah/menghapus soal atau paket).
 */
export async function cekSesiMapelKelasSudahMulai(
  db: DbClient,
  mapelId: string | null | undefined,
  kelasId: string | null | undefined
): Promise<SesiMapelKelasInfo | null> {
  if (!mapelId || !kelasId) return null

  const { data: kelasRow } = await db
    .from('kelas')
    .select('nama')
    .eq('id', kelasId)
    .maybeSingle()

  const kelasNama = kelasRow?.nama ? String(kelasRow.nama) : null
  if (!kelasNama) return null

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi, status')
    .eq('mapel_id', mapelId)
    .eq('kelas', kelasNama)
    .in('status', ['BERJALAN', 'SELESAI'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sesi) return null

  return { sesiId: sesi.id, kodeSesi: sesi.kode_sesi ?? null, status: sesi.status }
}

/** Pesan error standar untuk response 409 saat bank soal terkunci karena sesi sudah mulai. */
export function pesanBankSoalTerkunci(
  jenis: 'PG' | 'Essay',
  sesi: SesiMapelKelasInfo,
  aksi: 'menambah' | 'mengubah' | 'menghapus' | 'mengajukan' = 'menambah'
): string {
  const kondisi = sesi.status === 'BERJALAN' ? 'sedang berlangsung' : 'sudah pernah berlangsung'
  return `Sesi ujian untuk mata pelajaran dan kelas ini ${kondisi}, jadi soal ${jenis} tidak bisa ` +
    `${aksi} lagi. Ini untuk menjaga soal yang sudah/sedang dipakai siswa tetap konsisten dengan ` +
    `apa yang diujikan.`
}
