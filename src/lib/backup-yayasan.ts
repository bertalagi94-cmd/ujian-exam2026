// Backup & Restore yang DIBATASI KE SATU YAYASAN.
//
// LATAR BELAKANG
// Backup dan Restore lama bekerja pada seluruh database (createAdminClient()
// polos + TRUNCATE + upsert tanpa filter), sehingga:
//   - Backup oleh admin satu yayasan ikut membawa data yayasan lain, dan
//   - Restore bisa menimpa/menghapus data semua yayasan.
// Karena itu keduanya dulu dikunci (403) saat MULTI_YAYASAN_ENABLED menyala atau
// tabel `yayasan` berisi lebih dari satu baris.
//
// CARA KERJA SEKARANG (mengikuti pola reset-yayasan.ts)
//   1. Tabel yang punya kolom yayasan_id dibaca/ditulis lewat tenantDb(yayasanId),
//      yang otomatis menambah `.eq('yayasan_id', ...)` pada select/delete/update
//      dan mengisi yayasan_id pada insert/upsert.
//   2. Tabel anak TANPA yayasan_id dibatasi lewat daftar milik yayasan ini:
//        sesi_id  → siswa_ujian, jawaban, jawaban_essay, jawaban_essay_foto,
//                   skor_essay_siswa, essay_amplop_offline
//        nis      → log_reset
//        username → guru_sekolah
//   3. Saat Restore, setiap baris dari file backup diperiksa SEBELUM ditulis:
//        - yayasan_id (kalau ada) harus yayasan si admin,
//        - baris anak harus menunjuk sesi/nis/username milik yayasan ini,
//        - kunci utama (PK) yang masih global (id, nis, username) tidak boleh
//          sudah dipakai baris yayasan LAIN — kalau sampai bentrok, upsert akan
//          menimpa data yayasan lain, jadi ditolak.
//   4. File Storage dibatasi: folder soal & logo yayasan ini, dan foto essay
//      yang dirujuk baris milik yayasan ini. Logo aplikasi (folder `global/`)
//      dan file yayasan lain tidak pernah disentuh.
//
// Tabel yang tidak dikenal DITOLAK (fail-closed), bukan diproses tanpa filter.

import { createAdminClient } from '@/lib/supabase'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import {
  isBucketMissingError,
  isMissingTableError,
  isSafeStoragePath,
  listBucketFiles,
  pkOf,
  resolveFotoEssayStorageTarget,
  type Db,
} from '@/lib/backup-restore-shared'
import { TABEL_ANAK_NIS, TABEL_ANAK_SESI, type LingkupYayasan } from '@/lib/reset-yayasan'
import { TABEL_PER_YAYASAN, YAYASAN_AWAL_ID } from '@/lib/tenant'

type AnyRow = Record<string, unknown>

// Ukuran potongan agar URL permintaan PostgREST tidak kepanjangan.
const POTONG_SESI = 20
const POTONG_LAIN = 100
const POTONG_CEK_PK = 100

function potong<T>(arr: T[], ukuran: number): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

// ── Cara sebuah tabel dibatasi ke yayasan ────────────────────────────────────
export type KolomDaftar = 'sesi_id' | 'nis' | 'username'

export type CaraLingkup =
  | { jenis: 'yayasan' }
  | { jenis: 'daftar'; kolom: KolomDaftar; ukuranPotong: number }

/** Null = tabel tidak bisa dibatasi ke satu yayasan (ditolak). */
export function caraLingkup(tabel: string): CaraLingkup | null {
  if (TABEL_PER_YAYASAN.has(tabel)) return { jenis: 'yayasan' }
  if (TABEL_ANAK_SESI.has(tabel)) return { jenis: 'daftar', kolom: 'sesi_id', ukuranPotong: POTONG_SESI }
  if (TABEL_ANAK_NIS.has(tabel)) return { jenis: 'daftar', kolom: 'nis', ukuranPotong: POTONG_LAIN }
  if (tabel === 'guru_sekolah') return { jenis: 'daftar', kolom: 'username', ukuranPotong: POTONG_LAIN }
  return null
}

/** Nama tabel pertama dari daftar yang TIDAK bisa dibatasi ke yayasan, atau null. */
export function tabelBackupTidakAman(tabel: string[]): string | null {
  for (const t of tabel) if (!caraLingkup(t)) return t
  return null
}

function daftarNilai(ls: LingkupYayasan, kolom: KolomDaftar): Promise<string[]> {
  if (kolom === 'sesi_id') return ls.sesiIds()
  if (kolom === 'nis') return ls.nisSiswa()
  return ls.usernames()
}

// ── Baca (Backup) ────────────────────────────────────────────────────────────

/** Jumlah baris tabel ini milik yayasan di `ls`. */
export async function hitungTabel(
  ls: LingkupYayasan,
  tabel: string
): Promise<{ count: number; error?: string }> {
  const cara = caraLingkup(tabel)
  if (!cara) return { count: 0, error: `${tabel}: tidak dapat dibatasi ke satu yayasan` }
  try {
    if (cara.jenis === 'yayasan') {
      const { count, error } = await ls.db.from(tabel).select('*', { count: 'exact', head: true })
      return error ? { count: 0, error: error.message } : { count: count ?? 0 }
    }
    let total = 0
    for (const bagian of potong(await daftarNilai(ls, cara.kolom), cara.ukuranPotong)) {
      const { count, error } = await ls.db
        .from(tabel)
        .select('*', { count: 'exact', head: true })
        .in(cara.kolom, bagian)
      if (error) return { count: 0, error: error.message }
      total += count ?? 0
    }
    return { count: total }
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : 'error' }
  }
}

/**
 * Satu halaman baris tabel milik yayasan ini, mulai dari offset logis `dari`.
 * Untuk tabel anak, offset berlaku atas gabungan semua potongan (urut per
 * potongan, lalu PK). Satu halaman tidak melewati batas potongan, jadi bisa
 * lebih pendek dari `limit` — pemanggil melanjutkan dari dari + rows.length
 * sampai halaman kosong (persis cara klien backup bekerja).
 */
export async function halamanTabel(
  ls: LingkupYayasan,
  tabel: string,
  dari: number,
  limit: number
): Promise<{ rows: unknown[]; error?: string }> {
  const cara = caraLingkup(tabel)
  if (!cara) return { rows: [], error: `${tabel}: tidak dapat dibatasi ke satu yayasan` }

  // Nama kolom/tabel dinamis membuat tipe select() Supabase tidak bisa disimpulkan.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const urut = (q: any): any => {
    let hasil = q
    for (const col of pkOf(tabel)) hasil = hasil.order(col, { ascending: true })
    return hasil
  }

  try {
    if (cara.jenis === 'yayasan') {
      const { data, error } = await urut(ls.db.from(tabel).select('*')).range(dari, dari + limit - 1)
      return error ? { rows: [], error: error.message } : { rows: (data ?? []) as unknown[] }
    }

    let terlewati = 0
    for (const bagian of potong(await daftarNilai(ls, cara.kolom), cara.ukuranPotong)) {
      const { count, error: errHitung } = await ls.db
        .from(tabel)
        .select('*', { count: 'exact', head: true })
        .in(cara.kolom, bagian)
      if (errHitung) return { rows: [], error: errHitung.message }
      const jumlah = count ?? 0
      if (dari >= terlewati + jumlah) {
        terlewati += jumlah
        continue
      }
      const mulai = dari - terlewati
      const { data, error } = await urut(ls.db.from(tabel).select('*').in(cara.kolom, bagian)).range(
        mulai,
        mulai + limit - 1
      )
      return error ? { rows: [], error: error.message } : { rows: (data ?? []) as unknown[] }
    }
    return { rows: [] }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'error' }
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface FileStorage {
  bucket: string
  path: string
}

export interface DaftarStorage {
  /** Semua file milik yayasan ini (folder assets + foto essay). */
  files: FileStorage[]
  /** Hanya file di folder assets milik yayasan (soal & logo) — dasar storage-prune. */
  folderAssets: string[]
  errors: string[]
}

const POLA_LOGO_SEKOLAH = /^logo_sekolah\.[A-Za-z0-9]+$/
const POLA_LOGO_JENJANG = /^logo-(.+)\.[A-Za-z0-9]+$/

// Daftar file DI AKAR bucket (tidak rekursif). Yayasan awal menyimpan logonya
// di akar, berdampingan dengan folder yayasan lain, `global/` dan `soal/`.
async function daftarAkarBucket(db: Db, bucket: string): Promise<{ names: string[]; error?: string }> {
  const LIMIT = 1000
  const names: string[] = []
  for (let offset = 0; ; offset += LIMIT) {
    const { data, error } = await db.storage
      .from(bucket)
      .list('', { limit: LIMIT, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      if (isBucketMissingError(error.message)) return { names: [] }
      return { names, error: `${bucket}: ${error.message}` }
    }
    if (!data || data.length === 0) break
    for (const e of data) if (e.id !== null) names.push(e.name) // id null = sub-folder
    if (data.length < LIMIT) break
  }
  return { names }
}

/** Folder assets milik yayasan: awal = akar (logo) + soal/, lainnya = folder `<id>/`. */
async function daftarFolderAssets(ls: LingkupYayasan): Promise<{ paths: string[]; error?: string }> {
  if (ls.yayasanId !== YAYASAN_AWAL_ID) {
    const r = await listBucketFiles(ls.db, 'assets', ls.yayasanId)
    if (r.bucketMissing) return { paths: [] }
    return { paths: r.paths, error: r.error ? `storage/${r.error}` : undefined }
  }

  const hasil: string[] = []
  let error: string | undefined
  const soal = await listBucketFiles(ls.db, 'assets', 'soal')
  if (!soal.bucketMissing) {
    hasil.push(...soal.paths)
    if (soal.error) error = `storage/${soal.error}`
  }
  const akar = await daftarAkarBucket(ls.db, 'assets')
  if (akar.error) error = error ?? `storage/${akar.error}`
  const sekolah = new Set(await ls.sekolahIds())
  for (const nama of akar.names) {
    if (POLA_LOGO_SEKOLAH.test(nama)) {
      hasil.push(nama)
      continue
    }
    const m = POLA_LOGO_JENJANG.exec(nama)
    if (m && sekolah.has(m[1])) hasil.push(nama)
  }
  return { paths: hasil, error }
}

/** Foto jawaban essay yang dirujuk baris jawaban_essay_foto milik yayasan ini. */
async function daftarFotoEssay(ls: LingkupYayasan): Promise<{ files: FileStorage[]; error?: string }> {
  const unik = new Map<string, FileStorage>()
  for (const bagian of potong(await ls.sesiIds(), POTONG_SESI)) {
    const { data, error } = await ambilSemuaBaris<{ foto_url: string | null }>((dari, sampai) =>
      ls.db.from('jawaban_essay_foto').select('id, foto_url').in('sesi_id', bagian).order('id').range(dari, sampai)
    )
    if (error) {
      if (isMissingTableError(error.message)) return { files: [] }
      return { files: [...unik.values()], error: `jawaban_essay_foto: ${error.message}` }
    }
    for (const r of data) {
      const t = resolveFotoEssayStorageTarget(r.foto_url)
      if (t) unik.set(`${t.bucket}/${t.path}`, t)
    }
  }
  return { files: [...unik.values()] }
}

export async function daftarStorageYayasan(ls: LingkupYayasan): Promise<DaftarStorage> {
  const errors: string[] = []
  const folder = await daftarFolderAssets(ls)
  if (folder.error) errors.push(folder.error)
  const foto = await daftarFotoEssay(ls)
  if (foto.error) errors.push(`storage/${foto.error}`)

  const folderAssets = folder.paths
  const files: FileStorage[] = folderAssets.map(path => ({ bucket: 'assets', path }))
  const sudah = new Set(files.map(f => `${f.bucket}/${f.path}`))
  for (const f of foto.files) {
    if (!sudah.has(`${f.bucket}/${f.path}`)) files.push(f)
  }
  return { files, folderAssets, errors }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`)
}

async function fotoEssayMilikYayasan(ls: LingkupYayasan, bucket: string, path: string): Promise<boolean> {
  // jawaban_essay_foto tidak punya yayasan_id: cari baris yang merujuk file ini,
  // lalu pastikan sesi pemiliknya milik yayasan ini.
  const q = ls.db.from('jawaban_essay_foto').select('foto_url, sesi_id')
  const { data, error } =
    bucket === 'jawaban-essay'
      ? await q.eq('foto_url', path).limit(50)
      : await q.like('foto_url', `%${escapeLike(path)}`).limit(50)
  if (error || !data) return false

  const sesiSaya = new Set(await ls.sesiIds())
  for (const r of data as { foto_url: string | null; sesi_id: string }[]) {
    const t = resolveFotoEssayStorageTarget(r.foto_url)
    if (t && t.bucket === bucket && t.path === path && sesiSaya.has(String(r.sesi_id))) return true
  }
  return false
}

/**
 * Apakah file Storage ini milik yayasan di `ls`? Dipakai Backup (sebelum
 * mengunduh file) dan Restore (sebelum mengunggah/menimpa file). Fail-closed:
 * tidak yakin = bukan milik.
 */
export async function fileStorageMilikYayasan(ls: LingkupYayasan, bucket: string, path: unknown): Promise<boolean> {
  if (!isSafeStoragePath(path)) return false
  try {
    if (bucket === 'assets') {
      if (ls.yayasanId !== YAYASAN_AWAL_ID) {
        if (path.startsWith(`${ls.yayasanId}/`)) return true
      } else {
        if (path.startsWith('soal/')) return true
        if (!path.includes('/')) {
          if (POLA_LOGO_SEKOLAH.test(path)) return true
          const m = POLA_LOGO_JENJANG.exec(path)
          if (m && (await ls.sekolahIds()).includes(m[1])) return true
        }
      }
    }
    if (bucket === 'assets' || bucket === 'jawaban-essay') {
      return await fotoEssayMilikYayasan(ls, bucket, path)
    }
    return false
  } catch {
    return false
  }
}

// ── Tulis (Restore) ──────────────────────────────────────────────────────────

async function cekBentrokPkLintasYayasan(
  ls: LingkupYayasan,
  tabel: string,
  rows: AnyRow[],
  kolomPemilik: 'yayasan_id' | KolomDaftar,
  milik: (nilai: string) => boolean
): Promise<string | null> {
  const pk = pkOf(tabel)
  // PK gabungan sudah memuat kolom pemilik (essay_amplop_offline: sesi_id,
  // guru_sekolah: username) atau yayasan_id (pengaturan, admin_kelas), jadi
  // bentrok dengan baris yayasan lain mustahil. Hanya PK tunggal yang dicek.
  if (pk.length !== 1 || pk[0] === kolomPemilik) return null
  const kolomPk = pk[0]

  const kunci = [...new Set(rows.map(r => String(r[kolomPk])))]
  const admin = createAdminClient()
  for (const bagian of potong(kunci, POTONG_CEK_PK)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.from(tabel) as any).select(`${kolomPk}, ${kolomPemilik}`).in(kolomPk, bagian)
    if (error) return `${tabel}: gagal memeriksa kunci yang sudah ada (${error.message})`
    for (const r of (data ?? []) as AnyRow[]) {
      if (!milik(String(r[kolomPemilik]))) {
        return `${tabel}: kunci "${String(r[kolomPk])}" sudah dipakai data yayasan lain, restore dibatalkan supaya data itu tidak tertimpa`
      }
    }
  }
  return null
}

/**
 * Periksa satu batch baris dari file backup SEBELUM ditulis. Mengembalikan
 * pesan error (batch ditolak seluruhnya), atau null kalau aman.
 */
export async function validasiBarisRestore(
  ls: LingkupYayasan,
  tabel: string,
  rows: unknown[]
): Promise<string | null> {
  const cara = caraLingkup(tabel)
  if (!cara) return `${tabel}: tidak dapat dibatasi ke satu yayasan, tidak dipulihkan`
  if (!rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
    return `${tabel}: ada baris yang bukan objek`
  }
  const data = rows as AnyRow[]
  const yid = ls.yayasanId

  if (cara.jenis === 'yayasan') {
    for (const r of data) {
      if (r.yayasan_id != null && r.yayasan_id !== yid) {
        return `${tabel}: file backup memuat data yayasan lain (${String(r.yayasan_id)}), restore ditolak`
      }
    }

    // Jenjang (sekolah) yang ditunjuk users/kelas harus milik yayasan ini.
    if (tabel === 'users' || tabel === 'kelas') {
      const sekolah = new Set(await ls.sekolahIds())
      for (const r of data) {
        if (r.sekolah_id != null && r.sekolah_id !== '' && !sekolah.has(String(r.sekolah_id))) {
          return `${tabel}: baris merujuk sekolah yang bukan milik yayasan ini`
        }
      }
    }

    if (tabel === 'pengaturan' || tabel === 'admin_kelas') return null
    for (const r of data) {
      if (r[pkOf(tabel)[0]] == null) return `${tabel}: ada baris tanpa kunci utama`
    }
    return cekBentrokPkLintasYayasan(ls, tabel, data, 'yayasan_id', v => v === yid)
  }

  // Tabel anak tanpa yayasan_id: setiap baris harus menunjuk milik yayasan ini.
  const milikSaya = new Set(await daftarNilai(ls, cara.kolom))
  for (const r of data) {
    const nilai = r[cara.kolom]
    if (nilai == null || !milikSaya.has(String(nilai))) {
      return `${tabel}: ada baris dengan ${cara.kolom} yang bukan milik yayasan ini, restore ditolak`
    }
  }
  if (tabel === 'guru_sekolah') {
    const sekolah = new Set(await ls.sekolahIds())
    for (const r of data) {
      if (r.sekolah_id == null || !sekolah.has(String(r.sekolah_id))) {
        return `guru_sekolah: ada baris dengan sekolah_id yang bukan milik yayasan ini`
      }
    }
  }
  return cekBentrokPkLintasYayasan(ls, tabel, data, cara.kolom, v => milikSaya.has(v))
}
