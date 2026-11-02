import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { yayasanIdDari } from '@/lib/tenant'
import { cacheDel, cacheDelPrefix } from '@/lib/cache'
import {
  DELETE_ORDER,
  cekProsesDataBesarBerjalan,
  mulaiModeMaintenanceUntukProses,
  selesaiModeMaintenanceUntukProses,
} from '@/lib/backup-restore-shared'
import {
  buatLingkupYayasan,
  cekAktivitasUjianYayasan,
  hapusTabelYayasan,
  muatDaftarId,
  tabelTidakAman,
  tabelYangDiproses,
} from '@/lib/reset-yayasan'

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
  semua: [...DELETE_ORDER, 'metrik_sistem'],  // guru_sekolah & metrik_sistem dilewati (lihat reset-yayasan.ts)
}

// PERBAIKAN (reset per yayasan): route ini dulu memakai createAdminClient()
// polos + TRUNCATE, sehingga Reset oleh admin satu yayasan menghapus data
// SEMUA yayasan di database yang sama. Sekarang seluruh penghapusan lewat
// src/lib/reset-yayasan.ts yang terkunci ke yayasan si admin (dari token),
// jadi aman dipakai walau MULTI_YAYASAN_ENABLED mati. File Storage yang
// dibersihkan juga hanya milik yayasan ini.
//
// Catatan: akun ADMIN tidak pernah dihapus, dan kunci maintenance milik Panel
// Developer tidak ikut terhapus oleh kategori "pengaturan"/"semua".
export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let yayasanId: string
  try {
    yayasanId = yayasanIdDari(auth.user)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Silakan login ulang.' }, { status: 401 })
  }

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

  const effectiveCategories = categories.includes('semua')
    ? ['semua' as ResetCategory]
    : categories

  // Kumpulkan tabel unik. Urutan antar kategori dipertahankan seperti yang
  // dipilih, tapi setiap tabel hanya diproses sekali.
  const rencana: string[] = []
  for (const cat of effectiveCategories) {
    for (const table of CATEGORY_MAP[cat]) {
      if (!rencana.includes(table)) rencana.push(table)
    }
  }
  const tablesToDelete = tabelYangDiproses(rencana)

  // Fail-closed: tabel yang tidak bisa dibatasi ke satu yayasan tidak boleh
  // disentuh sama sekali (mis. tabel baru yang lupa didaftarkan).
  const tidakAman = tabelTidakAman(tablesToDelete)
  if (tidakAman) {
    return NextResponse.json(
      { error: `Reset dibatalkan: tabel "${tidakAman}" belum bisa dibatasi ke satu yayasan.` },
      { status: 500 }
    )
  }

  const ls = buatLingkupYayasan(yayasanId)
  const db = ls.db // terkunci ke yayasan si admin

  // Ambil daftar sesi/nis milik yayasan ini SEKARANG, sebelum ada baris yang
  // dihapus (penghapusan tabel anak bergantung pada daftar ini).
  const errDaftar = await muatDaftarId(ls, tablesToDelete)
  if (errDaftar) {
    return NextResponse.json({ error: `Gagal membaca data yayasan: ${errDaftar}` }, { status: 500 })
  }

  // ── CEK AKTIVITAS SEBELUM RESET ─────────────────────────────────────────
  // Tolak reset jika ada sesi ujian yang sedang berjalan atau siswa yang
  // sedang aktif mengerjakan DI YAYASAN INI (ujian yayasan lain tidak
  // dihitung). Admin harus konfirmasi paksa (force=true) hanya jika kondisi
  // sudah diketahui dan tetap ingin dilanjutkan.
  if (!force) {
    const akt = await cekAktivitasUjianYayasan(ls)
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
  // jalan) — data yayasan ini mungkin dalam kondisi campuran yang tidak
  // konsisten. Tampilkan peringatan tegas dulu sebelum mengizinkan reset baru
  // menimpa kondisi itu tanpa admin sadar. `force` yang sama dipakai admin
  // untuk melewati peringatan ini (konsisten dengan pengecekan di atas).
  // Penanda disimpan per yayasan (tabel pengaturan lewat tenantDb).
  if (!force) {
    const prosesSebelumnya = await cekProsesDataBesarBerjalan(db)
    if (prosesSebelumnya.sedangBerjalan) {
      return NextResponse.json({
        error: `Proses ${prosesSebelumnya.jenis ?? 'reset/restore'} sebelumnya (dimulai ${prosesSebelumnya.mulaiPada ?? 'waktu tidak diketahui'}) tampak TIDAK PERNAH SELESAI — kemungkinan terputus di tengah jalan (server restart, koneksi putus, dsb). Data mungkin berada dalam kondisi tidak konsisten. Periksa data secara manual dulu sebelum melanjutkan, atau konfirmasi paksa untuk tetap lanjut.`,
        proses_sebelumnya_belum_selesai: true,
        proses_sebelumnya: prosesSebelumnya,
      }, { status: 409 })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── MODE MAINTENANCE OTOMATIS SELAMA RESET (khusus yayasan ini) ─────────
  // Siswa/guru/kepsek yayasan ini tidak boleh memakai aplikasi SELAGI data
  // sedang dikosongkan. Dinyalakan sendiri di sini dan dikembalikan ke nilai
  // sebelumnya di `finally`, apa pun hasilnya. Yayasan lain tidak terpengaruh.
  // Target konflik 'yayasan_id,key': kunci utama pengaturan sejak migrasi 43.
  await mulaiModeMaintenanceUntukProses(db, 'reset', 'yayasan_id,key')
  try {
    const errors: string[] = []
    const deleted: string[] = []
    const storageSelesai = new Set<string>()
    const termasukSiswa = tablesToDelete.includes('siswa')

    for (const table of tablesToDelete) {
      const err = await hapusTabelYayasan(ls, table, { termasukSiswa, storageSelesai })
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
    // Kunci penanda proses & maintenanceAktif sengaja DIKECUALIKAN dari
    // penghapusan kategori "pengaturan"/"semua" (lihat reset-yayasan.ts), jadi
    // di sini cukup mengembalikan maintenanceAktif ke nilai sebelum reset dan
    // membersihkan penanda.
    await selesaiModeMaintenanceUntukProses(db, 'yayasan_id,key')
  }
}
