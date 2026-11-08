// src/lib/sesi-utama.ts
//
// ── PENCARI SESI UTAMA ──────────────────────────────────────────────────────
// Dulu satu jadwal punya paling banyak SATU sesi BERJALAN (migrasi 37), jadi
// banyak route mencari "sesi milik jadwal ini" dengan
//   .eq('jadwal_id', x).eq('status', 'BERJALAN').single()
// atau mengambil baris pertama dari daftar sesi jadwal itu.
//
// Sejak Ruang Khusus (migrasi 65) satu jadwal bisa punya beberapa sesi:
//   - SATU sesi kelas            (sesi_ujian.ruang_khusus_id IS NULL)
//   - nol atau lebih sesi ruang  (ruang_khusus_id terisi, satu per ruang)
//
// Pencarian lama yang tidak tahu perbedaan ini bisa salah ambil. Contoh paling
// berbahaya: sesi ruang jalan lebih dulu, lalu pengawas kelas menekan "Mulai
// Ujian" -> pencarian lama menemukan sesi RUANG, menganggapnya sesi kelas, dan
// membagikan kode ruang. Sesi kelas tidak pernah dibuka.
//
// ATURAN: setiap kode yang bertanya "sesi kelas untuk jadwal ini" WAJIB lewat
// berkas ini, bukan menulis .eq('jadwal_id', ...) sendiri. Yang memang
// memerlukan SEMUA sesi sebuah jadwal (laporan, koreksi essay, tutup paksa)
// memakai kelompokkanSesiPerJadwal() dan memutuskan sendiri secara sadar.

import type { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

/** Bentuk minimum yang dibutuhkan fungsi di berkas ini. */
export interface SesiMinimal {
  id: string
  jadwal_id: string | null
  status: string | null
  ruang_khusus_id?: string | null
  waktu_mulai?: string | null
}

/** true bila sesi ini milik ruang khusus (bukan sesi kelas). */
export function adalahSesiRuang(s: { ruang_khusus_id?: string | null } | null | undefined): boolean {
  return !!s?.ruang_khusus_id
}

/** true bila sesi ini sesi kelas biasa. */
export function adalahSesiKelas(s: { ruang_khusus_id?: string | null } | null | undefined): boolean {
  return !!s && !s.ruang_khusus_id
}

/**
 * Dari daftar sesi (biasanya semua sesi satu jadwal), pilih SESI KELAS yang
 * mewakili jadwal itu: yang BERJALAN kalau ada, kalau tidak yang terbaru.
 * Sesi ruang khusus tidak pernah dikembalikan. Kembalikan null kalau jadwal
 * belum punya sesi kelas sama sekali (mis. hanya ruang khusus yang sudah jalan).
 */
export function pilihSesiUtama<T extends SesiMinimal>(daftar: readonly T[] | null | undefined): T | null {
  const kelas = (daftar ?? []).filter(adalahSesiKelas)
  if (kelas.length === 0) return null
  const berjalan = kelas.find(s => s.status === 'BERJALAN')
  if (berjalan) return berjalan
  // Terbaru dulu. Tanpa waktu_mulai, urutan masukan dipertahankan.
  return [...kelas].sort((a, b) => String(b.waktu_mulai ?? '').localeCompare(String(a.waktu_mulai ?? '')))[0] ?? null
}

/** Kelompokkan sesi per jadwal_id, urutan masukan dipertahankan. */
export function kelompokkanSesiPerJadwal<T extends SesiMinimal>(
  daftar: readonly T[] | null | undefined
): Map<string, T[]> {
  const peta = new Map<string, T[]>()
  for (const s of daftar ?? []) {
    if (!s.jadwal_id) continue
    const arr = peta.get(s.jadwal_id)
    if (arr) arr.push(s)
    else peta.set(s.jadwal_id, [s])
  }
  return peta
}

/**
 * Pengganti `.eq('jadwal_id', id).eq('status','BERJALAN').single()`:
 * sesi KELAS yang sedang BERJALAN untuk sebuah jadwal, atau null.
 *
 * Memakai .limit(1).maybeSingle() sehingga tidak pernah melempar error
 * "lebih dari satu baris" -- penjaga database menjamin paling banyak satu sesi
 * kelas BERJALAN per jadwal, dan sesi ruang disaring lewat ruang_khusus_id.
 */
export async function cariSesiKelasBerjalan(
  db: DbClient,
  jadwalId: string,
  kolom = 'id, kode_sesi, info_json, ruang_khusus_id'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const { data, error } = await db
    .from('sesi_ujian')
    .select(kolom)
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .is('ruang_khusus_id', null)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

/**
 * Sesi RUANG yang sedang BERJALAN untuk pasangan (jadwal, ruang), atau null.
 */
export async function cariSesiRuangBerjalan(
  db: DbClient,
  jadwalId: string,
  ruangId: string,
  kolom = 'id, kode_sesi, info_json, ruang_khusus_id'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const { data, error } = await db
    .from('sesi_ujian')
    .select(kolom)
    .eq('jadwal_id', jadwalId)
    .eq('ruang_khusus_id', ruangId)
    .eq('status', 'BERJALAN')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

/**
 * Apakah masih ada sesi BERJALAN lain (kelas ATAU ruang) untuk jadwal ini,
 * selain `kecualiSesiId`? Dipakai saat menutup sesi: status jadwal baru boleh
 * menjadi SELESAI kalau jawabannya false. Tanpa ini, menutup sesi kelas lebih
 * dulu membuat jadwal tampak SELESAI dan siswa ruang khusus yang belum masuk
 * melihat "ujian ditutup".
 */
export async function adaSesiBerjalanLain(
  db: DbClient,
  jadwalId: string,
  kecualiSesiId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .neq('id', kecualiSesiId)
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/**
 * Sesi yang harus ditampilkan di Mode Pengawas milik `username` untuk satu
 * jadwal. Satu jadwal bisa punya sesi kelas dan sesi ruang, dan tiap pengawas
 * hanya boleh melihat miliknya:
 *   - pengawas jadwal (jadwal.pengawas) -> sesi KELAS (pilihSesiUtama);
 *   - pengawas ruang / pengawas susulan -> sesi BERJALAN yang ditugaskan
 *     kepadanya (info_json.pengawas_susulan), diutamakan sesi ruang;
 *   - selain itu jatuh ke sesi kelas (perilaku lama).
 */
export function pilihSesiUntukPengawas<T extends SesiMinimal & { info_json?: { pengawas_susulan?: string } | null }>(
  daftar: readonly T[] | null | undefined,
  username: string,
  pengawasJadwal: string | null | undefined
): T | null {
  if (pengawasJadwal !== username) {
    const milikku = (daftar ?? []).filter(s =>
      s.status === 'BERJALAN' && s.info_json?.pengawas_susulan === username)
    const ruang = milikku.find(adalahSesiRuang)
    if (ruang) return ruang
    if (milikku[0]) return milikku[0]
  }
  return pilihSesiUtama(daftar)
}
