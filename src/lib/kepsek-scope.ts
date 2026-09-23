/**
 * Helper untuk mendapatkan daftar kelas yang boleh dilihat Kepsek,
 * berdasarkan sekolah_id yang tersimpan di akun Kepsek.
 * 
 * Kalau Kepsek tidak punya sekolah_id (belum diset admin),
 * kembalikan array kosong dan flag noScope=true agar API bisa
 * memberikan respons yang tepat.
 *
 * ── FIX BUG (fail-closed) ────────────────────────────────────────────────
 * Sebelumnya KEDUA query di bawah (`users` dan `kelas`) tidak pernah
 * memeriksa `error` — kalau query gagal (mis. koneksi database terputus,
 * bukan sekadar "tidak ketemu"), hasilnya `data` bernilai `null`/`undefined`
 * dan lolos begitu saja lewat `?? null` / `?? []`. Fungsi ini lalu diam-diam
 * mengembalikan `noScope: true` atau `kelasList: []` — SAMA PERSIS seperti
 * kalau Kepsek memang belum diset sekolahnya / sekolahnya memang belum
 * punya kelas. Karena fungsi ini dipakai untuk MEMBATASI akses data (bukan
 * cuma menampilkan pesan), menyamakan "query gagal" dengan "scope kosong"
 * masih tergolong fail-closed dari sisi tidak ada data bocor — tapi
 * menyembunyikan kegagalan database asli di balik pesan "akun belum diset
 * sekolah" membuatnya sulit dibedakan saat troubleshooting, dan berisiko
 * kalau suatu saat ada pemanggil yang menafsirkan noScope secara berbeda.
 * Sekarang: query yang benar-benar gagal MELEMPAR error (bukan mengembalikan
 * scope kosong secara diam-diam). Semua endpoint yang memanggil fungsi ini
 * TIDAK membungkusnya dengan try/catch, jadi error otomatis membuat Next.js
 * mengembalikan 500 ke klien — tetap fail-closed (tidak ada data yang
 * ditampilkan), tapi kegagalan database asli tidak lagi disamarkan.
 *
 * ── CATATAN ARSITEKTUR (belum diperbaiki di sini — butuh migrasi skema) ──
 * `kelasList` berisi NAMA kelas (kolom `kelas.nama`), bukan `kelas.id`,
 * karena data konsumen (siswa.kelas, sesi_ujian.kelas, nilai.kelas) semuanya
 * menyimpan nama kelas sebagai string bebas, BUKAN kelas_id, dan sama sekali
 * tidak punya sekolah_id sendiri. Akibatnya kalau dua sekolah kebetulan
 * punya kelas dengan nama PERSIS SAMA (mis. sama-sama "10"), scope ini tidak
 * bisa membedakan keduanya — guru/kepsek scope sama-sama punya keterbatasan
 * ini (lihat juga src/lib/guru-scope.ts). Solusi permanen: siswa/sesi_ujian/
 * nilai perlu merujuk kelas_id (atau sekolah_id) yang sebenarnya, bukan
 * nama sebagai string bebas — ini di luar cakupan perbaikan hardening kali
 * ini karena melibatkan migrasi data produksi, bukan sekadar penambahan
 * pengecekan otorisasi.
 */
import { createAdminClient } from '@/lib/supabase'

export interface KepsekScope {
  kelasList: string[]   // nama-nama kelas yang boleh diakses
  sekolahId: string | null
  noScope: boolean      // true = kepsek belum diset sekolahnya
}

export async function getKepsekScope(username: string): Promise<KepsekScope> {
  const db = createAdminClient()

  // 1. Ambil sekolah_id milik kepsek ini
  const { data: userRow, error: userError } = await db
    .from('users')
    .select('sekolah_id')
    .eq('username', username)
    .maybeSingle()

  if (userError) {
    throw new Error(`Gagal memuat data sekolah akun ini: ${userError.message}`)
  }

  const sekolahId = userRow?.sekolah_id ?? null

  if (!sekolahId) {
    return { kelasList: [], sekolahId: null, noScope: true }
  }

  // 2. Ambil semua kelas yang terikat ke sekolah ini
  const { data: kelasRows, error: kelasError } = await db
    .from('kelas')
    .select('nama')
    .eq('sekolah_id', sekolahId)

  if (kelasError) {
    throw new Error(`Gagal memuat daftar kelas sekolah: ${kelasError.message}`)
  }

  const kelasList = (kelasRows ?? []).map(k => k.nama)

  return { kelasList, sekolahId, noScope: false }
}

/**
 * Versi multi-sekolah dari getKepsekScope(), khusus untuk akun GURU.
 *
 * Beda dengan Kepsek (satu kepsek = satu sekolah yang diawasi), seorang
 * guru bisa mengajar di lebih dari satu sekolah/jenjang sekaligus (mis.
 * SMP dan SMA dalam satu yayasan). Karena itu scope guru dibaca dari tabel
 * relasi many-to-many `guru_sekolah` (lihat migrasi 24), bukan dari kolom
 * tunggal `users.sekolah_id` yang tetap dipakai apa adanya untuk Kepsek.
 */
export interface GuruScope {
  kelasList: string[]     // nama-nama kelas yang boleh diakses (gabungan semua sekolah guru ini)
  sekolahIds: string[]    // semua sekolah_id yang diajar guru ini
  noScope: boolean        // true = guru belum diset sekolah manapun
}

export async function getGuruSekolahScope(username: string): Promise<GuruScope> {
  const db = createAdminClient()

  // 1. Ambil semua sekolah yang diajar guru ini
  const { data: relasiRows, error: relasiError } = await db
    .from('guru_sekolah')
    .select('sekolah_id')
    .eq('username', username)

  if (relasiError) {
    throw new Error(`Gagal memuat data sekolah akun ini: ${relasiError.message}`)
  }

  const sekolahIds = [...new Set((relasiRows ?? []).map(r => r.sekolah_id))]

  if (sekolahIds.length === 0) {
    return { kelasList: [], sekolahIds: [], noScope: true }
  }

  // 2. Ambil semua kelas yang terikat ke salah satu sekolah tersebut
  const { data: kelasRows, error: kelasError } = await db
    .from('kelas')
    .select('nama')
    .in('sekolah_id', sekolahIds)

  if (kelasError) {
    throw new Error(`Gagal memuat daftar kelas sekolah: ${kelasError.message}`)
  }

  const kelasList = [...new Set((kelasRows ?? []).map(k => k.nama))]

  return { kelasList, sekolahIds, noScope: false }
}
