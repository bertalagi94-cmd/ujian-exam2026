import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cacheDel, cacheDelPrefix } from '@/lib/cache'
import {
  DELETE_ORDER,
  TRUNCATE_TABLES,
  cekAktivitasUjian,
  cekProsesDataBesarBerjalan,
  isMissingTableError,
  listBucketFiles,
  mulaiModeMaintenanceUntukProses,
  pkOf,
  removeFilesInChunks,
  selesaiModeMaintenanceUntukProses,
  type Db,
} from '@/lib/backup-restore-shared'

export type ResetCategory =
  | 'jawaban_nilai'
  | 'sesi_ujian'
  | 'soal_paket'
  | 'jadwal'
  | 'siswa'
  | 'kelas_mapel'
  | 'users'
  | 'log'
  | 'pengaturan'
  | 'semua'

// PERBAIKAN (versi ini):
//  - `skor_essay_siswa` (skor per butir soal essay, 12_skor_per_soal_essay.sql)
//    sebelumnya TIDAK ada di kategori manapun, termasuk "Semua" → tersisa
//    sebagai data yatim setelah reset. Sekarang ikut dihapus bersama
//    jawaban_essay.
//  - `essay_amplop_offline` (19_essay_amplop_offline.sql, data amplop essay
//    offline per sesi+siswa) juga tidak pernah ter-reset. Sekarang ikut
//    dihapus bersama sesi_ujian/siswa_ujian.
//  - Daftar "Semua" sekarang diambil dari DELETE_ORDER (backup-restore-shared)
//    supaya tidak bisa lagi menyimpang dari daftar tabel backup/restore.
//  - Penghapusan baris memakai `NOT (pk IS NULL)`. Versi lama memakai
//    `created_at > '1970-01-01'` untuk sebagian tabel, yang TIDAK menghapus
//    baris ber-created_at NULL (NULL > x = NULL) → "Reset berhasil" padahal
//    sisa baris masih ada.
//  - Pembersihan Storage: foto jawaban essay yang sekarang disimpan di bucket
//    PRIVAT `jawaban-essay` tidak pernah dibersihkan (reset hanya melihat
//    folder `jawaban-essay/` di bucket `assets`). Sekarang keduanya. Loop
//    penghapusan lama (list 100 → remove → ulang sampai kosong) juga bisa
//    berputar tanpa henti kalau ada entry yang tidak terhapus (mis. sub-folder);
//    sekarang seluruh path dikumpulkan dulu, lalu dihapus per 100.
//  - Error query pengecekan sesi aktif tidak lagi diabaikan.
const JAWABAN_ESSAY = ['jawaban_essay', 'jawaban_essay_foto', 'skor_essay_siswa']
const SESI_TURUNAN = [
  'pelanggaran',
  'log_reset',
  'nilai',
  'jawaban',
  ...JAWABAN_ESSAY,
  'essay_amplop_offline',
  'siswa_ujian',
  'sesi_ujian',
]
const BANK_SOAL = ['soal', 'soal_essay', 'kisi_kisi', 'paket_soal', 'paket_essay']

const CATEGORY_MAP: Record<ResetCategory, string[]> = {
  jawaban_nilai: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', ...JAWABAN_ESSAY],
  sesi_ujian: [...SESI_TURUNAN],
  soal_paket: [...SESI_TURUNAN, ...BANK_SOAL],
  // Sengaja HANYA menghapus tabel jadwal — nilai/jawaban adalah bukti
  // siswa sudah mengikuti ujian dan tidak boleh ikut terhapus di sini.
  // Kalau admin memang ingin reset nilai/jawaban juga, pakai kategori
  // 'jawaban_nilai' secara terpisah (bisa dipilih bersamaan dari UI).
  jadwal: ['jadwal'],
  siswa: [
    'pelanggaran',
    'log_reset',
    'nilai',
    'jawaban',
    ...JAWABAN_ESSAY,
    'essay_amplop_offline',
    'siswa_ujian',
    'siswa',
  ],
  kelas_mapel: [
    ...SESI_TURUNAN,
    ...BANK_SOAL,
    'jadwal',
    'siswa',
    'kelas_mapel',
    'mapel',
    'kelas',
  ],
  users: ['log_aktivitas', 'log_reset', 'users'],
  log: ['log_aktivitas', 'log_reset'],
  pengaturan: ['pengaturan'],
  // `sekolah` hanya dihapus di 'semua': users.sekolah_id & kelas.sekolah_id
  // adalah FK ke tabel ini, dan di sini users & kelas sudah terhapus lebih dulu.
  // `metrik_sistem` (telemetri sementara) ikut dibersihkan supaya "kembali
  // seperti baru" benar-benar bersih.
  semua: [...DELETE_ORDER, 'metrik_sistem'],
}

// File fisik di Storage yang berasosiasi dengan tabel. Dibersihkan SEBELUM baris
// DB-nya dihapus, supaya kalau reset gagal di tengah jalan kita tidak kehilangan
// jejak URL/path file yang belum sempat terhapus.
//   - assets/soal/            : gambar soal PG & essay (guru/soal/upload)
//   - assets/jawaban-essay/   : foto jawaban essay versi LAMA (bucket publik)
//   - bucket jawaban-essay    : foto jawaban essay versi baru (bucket privat)
const STORAGE_BY_TABLE: Record<string, { bucket: string; prefix: string }[]> = {
  jawaban_essay_foto: [
    { bucket: 'assets', prefix: 'jawaban-essay' },
    { bucket: 'jawaban-essay', prefix: '' },
  ],
  soal: [{ bucket: 'assets', prefix: 'soal' }],
  soal_essay: [{ bucket: 'assets', prefix: 'soal' }],
}

async function clearStorage(
  db: Db,
  target: { bucket: string; prefix: string }
): Promise<string | null> {
  try {
    const listed = await listBucketFiles(db, target.bucket, target.prefix)
    if (listed.bucketMissing) return null // bucket tidak ada = tidak ada yang perlu dihapus
    if (listed.error) return `storage:${listed.error}`
    if (listed.paths.length === 0) return null
    const err = await removeFilesInChunks(db, target.bucket, listed.paths)
    return err ? `storage:${err}` : null
  } catch (e) {
    return `storage:${target.bucket}/${target.prefix}: ${e instanceof Error ? e.message : 'error'}`
  }
}

async function clearTable(
  db: Db,
  table: string,
  storageDone: Set<string>
): Promise<string | null> {
  const targets = STORAGE_BY_TABLE[table]
  if (targets) {
    for (const t of targets) {
      const key = `${t.bucket}/${t.prefix}`
      if (storageDone.has(key)) continue // soal & soal_essay berbagi folder yang sama
      const err = await clearStorage(db, t)
      if (err) return err
      storageDone.add(key)
    }
  }

  try {
    // Tabel besar → TRUNCATE via RPC (eksekusi di DB, tidak timeout di Vercel)
    if (TRUNCATE_TABLES.has(table)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).rpc('truncate_tabel_besar', { nama_tabel: table })
      if (!error) return null
      if (isMissingTableError(error.message)) return null
      // Fungsi lama belum memasukkan tabel ini ke whitelist (migrasi 22 belum
      // dijalankan) → jatuh ke DELETE biasa alih-alih gagal.
      if (!/tidak diizinkan/i.test(error.message)) return `${table}: ${error.message}`
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).delete()
    if (table === 'users') {
      // Jangan hapus akun ADMIN
      q = q.neq('role', 'ADMIN')
    } else {
      q = q.not(pkOf(table)[0], 'is', null)
    }
    const { error } = await q
    if (error) {
      if (isMissingTableError(error.message)) return null
      return `${table}: ${error.message}`
    }
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    if (isMissingTableError(msg)) return null
    return `${table}: ${msg}`
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let body: { categories: ResetCategory[]; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const { categories, force } = body

  if (!Array.isArray(categories) || categories.length === 0) {
    return NextResponse.json({ error: 'Pilih minimal satu kategori reset' }, { status: 400 })
  }

  const validCategories = Object.keys(CATEGORY_MAP) as ResetCategory[]
  const invalid = categories.filter(c => !validCategories.includes(c))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Kategori tidak valid: ${invalid.join(', ')}` }, { status: 400 })
  }

  const db = createAdminClient()

  // ── CEK AKTIVITAS SEBELUM RESET ─────────────────────────────────────────
  // Tolak reset jika ada sesi ujian yang sedang berjalan atau siswa yang
  // sedang aktif mengerjakan. Admin harus konfirmasi paksa (force=true) hanya
  // jika kondisi sudah diketahui dan tetap ingin dilanjutkan.
  if (!force) {
    const akt = await cekAktivitasUjian(db)
    if (akt.error) {
      return NextResponse.json({ error: `Gagal memeriksa sesi ujian aktif: ${akt.error}` }, { status: 500 })
    }
    if (akt.adaSesi || akt.adaSiswa) {
      const pesan: string[] = []
      if (akt.adaSesi) pesan.push('ada sesi ujian yang sedang berjalan')
      if (akt.adaSiswa) pesan.push('ada siswa yang sedang mengerjakan ujian')
      return NextResponse.json({
        error: `Reset tidak bisa dilakukan karena ${pesan.join(' dan ')}. Tutup semua sesi terlebih dahulu, lalu coba lagi.`,
        ada_aktivitas: true,
        ada_sesi: akt.adaSesi,
        ada_siswa: akt.adaSiswa,
      }, { status: 409 })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── FIX (audit brief bagian N): DETEKSI PROSES SEBELUMNYA YANG TERPUTUS ──
  // Kalau penanda "sedang berjalan" masih menyala, reset/restore SEBELUMNYA
  // tidak pernah mencapai tahap akhir (mis. server crash/redeploy di tengah
  // jalan) — database mungkin dalam kondisi campuran yang tidak konsisten.
  // Tampilkan peringatan tegas dulu sebelum mengizinkan reset baru menimpa
  // kondisi itu tanpa admin sadar. `force` yang sama dipakai admin untuk
  // melewati peringatan ini (konsisten dengan pengecekan aktivitas di atas).
  if (!force) {
    const prosesSebelumnya = await cekProsesDataBesarBerjalan(db)
    if (prosesSebelumnya.sedangBerjalan) {
      return NextResponse.json({
        error: `Proses ${prosesSebelumnya.jenis ?? 'reset/restore'} sebelumnya (dimulai ${prosesSebelumnya.mulaiPada ?? 'waktu tidak diketahui'}) tampak TIDAK PERNAH SELESAI — kemungkinan terputus di tengah jalan (server restart, koneksi putus, dsb). Database mungkin berada dalam kondisi tidak konsisten. Periksa data secara manual dulu sebelum melanjutkan, atau konfirmasi paksa untuk tetap lanjut.`,
        proses_sebelumnya_belum_selesai: true,
        proses_sebelumnya: prosesSebelumnya,
      }, { status: 409 })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const effectiveCategories = categories.includes('semua')
    ? ['semua' as ResetCategory]
    : categories

  // Kumpulkan tabel unik. Urutan antar kategori dipertahankan seperti yang
  // dipilih, tapi setiap tabel hanya diproses sekali.
  const tablesToDelete: string[] = []
  for (const cat of effectiveCategories) {
    for (const table of CATEGORY_MAP[cat]) {
      if (!tablesToDelete.includes(table)) tablesToDelete.push(table)
    }
  }

  // ── FIX (audit brief bagian N): MODE MAINTENANCE OTOMATIS SELAMA RESET ──
  // Sebelumnya reset berjalan tanpa melindungi diri sama sekali — siswa/guru/
  // kepsek tetap bisa memakai aplikasi SELAGI tabel-tabel sedang dikosongkan,
  // kecuali admin ingat menyalakan maintenance manual lebih dulu. Sekarang
  // reset menyalakan sendiri (dan mengembalikan lagi di `finally`, apa pun
  // hasilnya — sukses, gagal sebagian, atau exception tak terduga).
  await mulaiModeMaintenanceUntukProses(db, 'reset')
  try {
    const errors: string[] = []
    const deleted: string[] = []
    const storageDone = new Set<string>()

    for (const table of tablesToDelete) {
      const err = await clearTable(db, table, storageDone)
      if (err) {
        errors.push(err)
      } else {
        deleted.push(table)
      }
    }

    if (errors.length > 0 && deleted.length === 0) {
      return NextResponse.json({ error: 'Reset gagal', details: errors }, { status: 500 })
    }

    // Endpoint dashboard dan beberapa endpoint pengaturan memakai in-memory
    // cache (lib/cache.ts, TTL 30–60 detik). Tanpa ini admin masih melihat
    // data lama sampai TTL habis.
    cacheDel('admin:dashboard')
    if (tablesToDelete.includes('pengaturan')) cacheDelPrefix('pengaturan:')

    return NextResponse.json({
      message: errors.length > 0 ? 'Reset selesai dengan beberapa error' : 'Reset berhasil',
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: errors.length > 0 ? 207 : 200 })
  } finally {
    // Catatan: kalau kategori yang direset mencakup 'pengaturan' (langsung
    // atau lewat 'semua'), tabel `pengaturan` — termasuk penanda proses ini
    // sendiri — sudah ikut terhapus di loop atas (pengaturan sengaja
    // diproses PALING AKHIR, lihat DELETE_ORDER). Itu bukan masalah:
    // selesaiModeMaintenanceUntukProses() memakai upsert, jadi baris
    // `maintenanceAktif` cukup ditulis ulang (default 'false', konsisten
    // dengan maksud reset kategori 'pengaturan' sendiri: kembali ke default).
    await selesaiModeMaintenanceUntukProses(db)
  }
}
