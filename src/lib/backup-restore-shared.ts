// Sumber kebenaran TUNGGAL untuk daftar tabel & helper yang dipakai bersama oleh
//   src/app/api/admin/backup/route.ts
//   src/app/api/admin/restore/route.ts
//   src/app/api/admin/reset/route.ts
//
// Sebelumnya tiap route punya daftar tabelnya sendiri-sendiri, dan itulah
// penyebab bug berulang "tabel baru dari migrasi tidak ikut ter-backup/reset"
// (kisi_kisi, sekolah, tabel essay, skor_essay_siswa, ...). Kalau nanti ada
// tabel baru: tambahkan di INSERT_ORDER di bawah — backup, restore, dan
// (kalau perlu) CATEGORY_MAP di reset/route.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { cacheDelPrefix } from '@/lib/cache'

// createAdminClient() mengembalikan SupabaseClient<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any>

// Urutan INSERT saat restore (induk sebelum anak). Urutan DELETE = kebalikannya.
// Tidak ada FK antar tabel aplikasi KECUALI users.sekolah_id & kelas.sekolah_id
// → sekolah (ON DELETE SET NULL, lihat 18_catat_tabel_sekolah_dan_kisi_kisi.sql),
// karena itu `sekolah` harus di-insert lebih dulu dan dihapus paling akhir.
//
// Tidak termasuk: `metrik_sistem` — data telemetri sementara yang dibuang
// otomatis setelah 6 jam (lihat 15_metrik_sistem.sql), tidak ada gunanya
// dipulihkan.
export const INSERT_ORDER: string[] = [
  'pengaturan',
  'sekolah',
  'kelas',
  'mapel',
  'kelas_mapel',
  'siswa',
  'users',
  'jadwal',
  'paket_soal',
  'soal',
  'kisi_kisi',
  'paket_essay',
  'soal_essay',
  'sesi_ujian',
  'siswa_ujian',
  'essay_amplop_offline',
  'jawaban',
  'jawaban_essay',
  'jawaban_essay_foto',
  'skor_essay_siswa',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
]

export const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse()

export const BACKUP_TABLES: string[] = INSERT_ORDER

export const SCHEMA_TABLES = new Set(INSERT_ORDER)

// Primary key tiap tabel. Dipakai untuk (1) ORDER BY paginasi backup — harus
// kolom yang unik & stabil, kalau tidak .range() bisa melompati/menduplikasi
// baris — dan (2) onConflict saat restore (upsert idempoten supaya batch yang
// dikirim ulang setelah gangguan jaringan tidak gagal "duplicate key").
export const TABLE_PK: Record<string, string[]> = {
  pengaturan: ['key'],
  siswa: ['nis'],
  users: ['username'],
  // PK gabungan (lihat 19_essay_amplop_offline.sql) — TIDAK punya kolom `id`.
  essay_amplop_offline: ['sesi_id', 'nis'],
}

export function pkOf(table: string): string[] {
  return TABLE_PK[table] ?? ['id']
}

// Tabel besar → dikosongkan lewat RPC truncate_tabel_besar (eksekusi di dalam
// database, tidak timeout). HARUS sinkron dengan whitelist fungsi SQL di
// supabase/22_perbaikan_backup_restore_reset.sql.
export const TRUNCATE_TABLES = new Set([
  'jawaban',
  'jawaban_essay',
  'jawaban_essay_foto',
  'skor_essay_siswa',
  'siswa_ujian',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
])

// ── Supabase Storage ─────────────────────────────────────────────────────────
// - `assets`         : bucket publik — logo sekolah/aplikasi (root), gambar soal
//                      (`soal/`), dan foto jawaban essay LAMA (`jawaban-essay/`).
// - `jawaban-essay`  : bucket PRIVAT — foto jawaban essay versi terbaru (dibaca
//                      lewat createSignedUrl di guru/koreksi-essay dan
//                      siswa/nilai/[id]). Sebelumnya TIDAK ikut ter-backup
//                      maupun ter-reset.
export const BACKUP_BUCKETS: { name: string; public: boolean }[] = [
  { name: 'assets', public: true },
  { name: 'jawaban-essay', public: false },
]

export function isKnownBucket(name: string): boolean {
  return BACKUP_BUCKETS.some(b => b.name === name)
}

// Batas per file yang ikut di-backup. Kenapa 3MB (bukan 10MB seperti dulu):
// file dikirim ke browser sebagai base64 di dalam JSON, dan Vercel membatasi
// body response ~4,5MB. 3MB → ±4MB base64, masih muat.
export const MAX_ASSET_BYTES = 3 * 1024 * 1024
// Batas panjang string base64 yang diterima restore dalam satu request.
export const MAX_ASSET_BASE64_CHARS = 4_300_000

// Path storage tidak boleh menyelinap keluar (../) atau absolut.
export function isSafeStoragePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length < 500 &&
    !path.startsWith('/') &&
    !path.split('/').some(seg => seg === '..')
  )
}

// ── Deteksi error ────────────────────────────────────────────────────────────
export function isMissingTableError(msg: string | undefined | null): boolean {
  if (!msg) return false
  return /does not exist|42P01|could not find the table|PGRST205/i.test(msg)
}

export function isBucketMissingError(msg: string | undefined | null): boolean {
  if (!msg) return false
  return /bucket not found/i.test(msg)
}

// ── Mode maintenance otomatis selama RESET / RESTORE ────────────────────────
// FIX (audit brief bagian N — "Backup/Restore/Reset Admin"): sebelumnya reset
// & restore berjalan TANPA melindungi diri dengan mode maintenance sama
// sekali — kalau admin lupa menyalakan `maintenanceAktif` secara manual dulu
// (di Pengaturan), siswa/guru/kepsek tetap bisa login & memakai aplikasi
// SELAGI tabel-tabel sedang dikosongkan/ditimpa. Restore khususnya berupa
// proses BERTAHAP (banyak request terpisah dari browser admin: start → clear
// → insert → ... → finish) — kalau tab admin tertutup/koneksi putus di
// tengah proses, database tertinggal dalam kondisi CAMPURAN separuh-lama-
// separuh-baru tanpa ada penanda apa pun bahwa itu terjadi.
//
// Helper di bawah membuat reset/restore MENYALAKAN sendiri mode maintenance
// tepat sebelum data mulai diubah, dan MEMATIKANNYA lagi (dikembalikan ke
// nilai SEBELUM proses dimulai — bukan dipaksa 'false', supaya tidak
// menimpa maintenance manual admin untuk alasan lain) setelah proses selesai
// atau gagal. Penanda `PENGATURAN_KEY_PROSES_BERJALAN` yang masih 'true' saat
// proses BARU hendak dimulai berarti proses SEBELUMNYA tidak pernah mencapai
// tahap akhir (finish/cleanup) — sinyal kuat bahwa ada restore/reset yang
// terputus dan database mungkin tidak konsisten; caller (reset/restore route)
// wajib menampilkan peringatan ini ke admin sebelum melanjutkan.
export const PENGATURAN_KEY_MAINTENANCE_AKTIF = 'maintenanceAktif'
export const PENGATURAN_KEY_PROSES_BERJALAN = 'prosesDataBesarSedangBerjalan'
export const PENGATURAN_KEY_PROSES_JENIS = 'prosesDataBesarJenis'
export const PENGATURAN_KEY_PROSES_MULAI = 'prosesDataBesarMulaiPada'
export const PENGATURAN_KEY_MAINTENANCE_SEBELUM = 'prosesDataBesarMaintenanceSebelumnya'

const SEMUA_KEY_PROSES = [
  PENGATURAN_KEY_PROSES_BERJALAN,
  PENGATURAN_KEY_PROSES_JENIS,
  PENGATURAN_KEY_PROSES_MULAI,
  PENGATURAN_KEY_MAINTENANCE_SEBELUM,
]

export interface StatusProsesBesar {
  sedangBerjalan: boolean
  jenis?: string
  mulaiPada?: string
}

/** Cek apakah ada proses reset/restore yang menandai dirinya "sedang berjalan" tapi belum pernah dituntaskan (finish/cleanup). */
export async function cekProsesDataBesarBerjalan(db: Db): Promise<StatusProsesBesar> {
  const { data } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', [PENGATURAN_KEY_PROSES_BERJALAN, PENGATURAN_KEY_PROSES_JENIS, PENGATURAN_KEY_PROSES_MULAI])
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    sedangBerjalan: map[PENGATURAN_KEY_PROSES_BERJALAN] === 'true',
    jenis: map[PENGATURAN_KEY_PROSES_JENIS],
    mulaiPada: map[PENGATURAN_KEY_PROSES_MULAI],
  }
}

/**
 * Nyalakan mode maintenance (kalau belum aktif) + tandai proses besar sedang
 * berjalan. WAJIB dipanggil di titik terakhir sebelum data benar-benar mulai
 * diubah (bukan di awal validasi) — lihat pemanggilnya di reset/route.ts &
 * restore/route.ts.
 */
export async function mulaiModeMaintenanceUntukProses(db: Db, jenis: 'reset' | 'restore'): Promise<void> {
  const { data: existing } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', PENGATURAN_KEY_MAINTENANCE_AKTIF)
    .maybeSingle()
  const maintenanceSebelumnya = existing?.value === 'true' ? 'true' : 'false'

  await db.from('pengaturan').upsert(
    [
      { key: PENGATURAN_KEY_PROSES_BERJALAN, value: 'true' },
      { key: PENGATURAN_KEY_PROSES_JENIS, value: jenis },
      { key: PENGATURAN_KEY_PROSES_MULAI, value: new Date().toISOString() },
      { key: PENGATURAN_KEY_MAINTENANCE_SEBELUM, value: maintenanceSebelumnya },
      { key: PENGATURAN_KEY_MAINTENANCE_AKTIF, value: 'true' },
    ],
    { onConflict: 'key' }
  )
  // Cache pengaturan (dipakai login/route.ts, TTL 60dtk) harus langsung basi
  // di process ini — tanpa ini pengguna lain bisa tetap lolos maintenance
  // sampai 60 detik ke depan, persis jendela yang ingin ditutup fix ini.
  cacheDelPrefix('pengaturan:')
}

/**
 * Matikan mode maintenance yang dinyalakan otomatis di atas (kembalikan ke
 * nilai SEBELUM proses dimulai) dan hapus semua penanda proses. WAJIB
 * dipanggil di blok `finally` pemanggilnya supaya tetap jalan walau proses
 * reset/restore gagal di tengah — idempotent, aman dipanggil walau penanda
 * sudah tidak ada.
 */
export async function selesaiModeMaintenanceUntukProses(db: Db): Promise<void> {
  const { data: sebelum } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', PENGATURAN_KEY_MAINTENANCE_SEBELUM)
    .maybeSingle()

  await db.from('pengaturan').upsert(
    [{ key: PENGATURAN_KEY_MAINTENANCE_AKTIF, value: sebelum?.value === 'true' ? 'true' : 'false' }],
    { onConflict: 'key' }
  )
  await db.from('pengaturan').delete().in('key', SEMUA_KEY_PROSES)
  cacheDelPrefix('pengaturan:')
}

// ── Cek aktivitas ujian ──────────────────────────────────────────────────────
// Dipakai backup, restore, DAN reset. Sebelumnya backup hanya mengecek
// sesi_ujian BERJALAN sementara restore/reset juga mengecek siswa_ujian AKTIF,
// dan error query diabaikan diam-diam (data null dianggap "tidak ada sesi").
export async function cekAktivitasUjian(
  db: Db
): Promise<{ adaSesi: boolean; adaSiswa: boolean; error?: string }> {
  const [sesi, siswa] = await Promise.all([
    db.from('sesi_ujian').select('id').eq('status', 'BERJALAN').limit(1),
    db.from('siswa_ujian').select('id').eq('status', 'AKTIF').limit(1),
  ])
  if (sesi.error || siswa.error) {
    return {
      adaSesi: false,
      adaSiswa: false,
      error: sesi.error?.message ?? siswa.error?.message ?? 'Gagal memeriksa aktivitas ujian',
    }
  }
  return {
    adaSesi: (sesi.data?.length ?? 0) > 0,
    adaSiswa: (siswa.data?.length ?? 0) > 0,
  }
}

// ── Storage helpers ──────────────────────────────────────────────────────────
// Daftar SEMUA file di bucket (rekursif, dengan paginasi). Berbeda dari versi
// lama yang menelan error listing (`if (error) break`) — di versi lama, gagal
// membaca bucket tampak sama dengan "bucket kosong", sehingga backup terlihat
// sukses padahal logo/gambar tidak terbawa, dan restore lalu MENGOSONGKAN
// bucket dan tidak mengembalikan apa-apa.
export async function listBucketFiles(
  db: Db,
  bucket: string,
  prefix = ''
): Promise<{ paths: string[]; error?: string; bucketMissing?: boolean }> {
  const LIMIT = 1000
  const paths: string[] = []
  const stack: string[] = [prefix]

  while (stack.length > 0) {
    const dir = stack.pop() as string
    let offset = 0

    for (;;) {
      const { data, error } = await db.storage
        .from(bucket)
        .list(dir, { limit: LIMIT, offset, sortBy: { column: 'name', order: 'asc' } })

      if (error) {
        if (isBucketMissingError(error.message)) return { paths: [], bucketMissing: true }
        return { paths, error: `${bucket}/${dir}: ${error.message}` }
      }
      if (!data || data.length === 0) break

      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name
        // Sub-folder direpresentasikan sebagai entry dengan id === null
        if (entry.id === null) stack.push(full)
        else paths.push(full)
      }

      if (data.length < LIMIT) break
      offset += LIMIT
    }
  }

  return { paths }
}

// Hapus banyak file sekaligus, dipecah per 100 path. Mengembalikan pesan error
// pertama, atau null kalau sukses.
export async function removeFilesInChunks(
  db: Db,
  bucket: string,
  paths: string[]
): Promise<string | null> {
  const CHUNK = 100
  for (let i = 0; i < paths.length; i += CHUNK) {
    const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + CHUNK))
    if (error) return `${bucket}: ${error.message}`
  }
  return null
}
