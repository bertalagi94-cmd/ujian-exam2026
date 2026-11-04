import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { YAYASAN_AWAL_ID, yayasanIdDari } from '@/lib/tenant'
import { cacheDelPrefix } from '@/lib/cache'
import {
  BACKUP_BUCKETS,
  DELETE_ORDER,
  INSERT_ORDER,
  MAX_ASSET_BASE64_CHARS,
  SCHEMA_TABLES,
  cekProsesDataBesarBerjalan,
  isBucketMissingError,
  isKnownBucket,
  isSafeStoragePath,
  mulaiModeMaintenanceUntukProses,
  onConflictOf,
  removeFilesInChunks,
  selesaiModeMaintenanceUntukProses,
  verifikasiTokenProses,
  type Db,
} from '@/lib/backup-restore-shared'
import {
  KUNCI_PENGATURAN_DIPERTAHANKAN,
  buatLingkupYayasan,
  cekAktivitasUjianYayasan,
  hapusTabelYayasan,
  type LingkupYayasan,
} from '@/lib/reset-yayasan'
import {
  daftarStorageYayasan,
  fileStorageMilikYayasan,
  tabelBackupTidakAman,
  validasiBarisRestore,
} from '@/lib/backup-yayasan'

const ON_CONFLICT_PENGATURAN = 'yayasan_id,key'

// =============================================================================
// RESTORE — API BERTAHAP (dipanggil berulang dari browser, lihat
// src/lib/backup-restore-client.ts)
//
// KENAPA DIUBAH (bug di versi lama):
//   1. Batas ukuran. Versi lama menerima SELURUH file backup di satu request.
//      Vercel membatasi body request ±4,5 MB dan UI memblokir file > 4 MB,
//      padahal backup nyata (33 ribu+ baris jawaban) ±10 MB+. Backup buatan
//      aplikasi ini sendiri tidak bisa direstore. Sekarang browser membaca file
//      dan mengirim batch kecil (< ~3 MB) satu per satu.
//   2. Timeout. Menghapus `jawaban` lewat DELETE biasa + insert ±40 ribu baris
//      + upload storage berurutan di satu request pasti melewati maxDuration.
//      Sekarang tiap request pendek; tabel besar dikosongkan dengan TRUNCATE.
//   3. Sequence. Baris di-insert dengan id eksplisit, sequence BIGSERIAL tidak
//      ikut maju → insert berikutnya (mis. simpan jawaban) menabrak primary key.
//      Sekarang action `finish` menyetel ulang sequence (lihat
//      supabase/22_perbaikan_backup_restore_reset.sql).
//   4. Validasi setelah menghapus. Versi lama menghapus semua data LALU baru
//      mengetahui backup-nya cacat. Sekarang action `start` memvalidasi dulu
//      (backup.errors kosong, row_counts cocok dengan isi sebenarnya, fungsi
//      SQL yang dibutuhkan sudah ada) SEBELUM ada data yang dihapus.
//   5. Kegagalan insert diteruskan diam-diam ke tabel berikutnya. Sekarang
//      klien berhenti seketika di kegagalan pertama.
//   6. Storage dikosongkan dulu baru diisi. Sekarang upload dulu, dan file
//      lama yang tidak ada di backup baru dihapus (`storage-prune`) HANYA kalau
//      semua upload sukses.
//   7. FIX (audit brief bagian N): tidak ada perlindungan mode maintenance
//      sama sekali — siswa/guru/kepsek tetap bisa memakai aplikasi SELAGI
//      restore bertahap sedang berjalan, dan kalau tab admin tertutup/koneksi
//      putus di tengah proses (antara `clear` dan `insert` suatu tabel),
//      database tertinggal dalam kondisi campuran separuh-lama-separuh-baru
//      tanpa penanda apa pun. Sekarang `start` menyalakan mode maintenance
//      sendiri tepat sebelum data mulai diubah (dikembalikan lagi di
//      `finish`), dan `start` berikutnya akan menolak (kecuali force=true)
//      kalau menemukan proses sebelumnya yang tidak pernah mencapai `finish`
//      — lihat src/lib/backup-restore-shared.ts.
//
// PER YAYASAN (perubahan ini):
//   Restore dulu bekerja pada SELURUH database (createAdminClient() polos,
//   TRUNCATE, upsert tanpa filter) sehingga dikunci saat saklar
//   MULTI_YAYASAN_ENABLED menyala atau ada lebih dari satu yayasan. Sekarang
//   semua langkah terkunci ke yayasan si admin yang login (dari token, bukan
//   dari input), jadi aman dipakai kapan pun:
//     - start  : file backup harus berasal dari yayasan yang sama (yayasan_id
//                di file). Backup lama tanpa yayasan_id hanya boleh dipulihkan
//                ke yayasan awal (YYS_AWAL).
//     - clear  : hanya baris yayasan ini (tanpa TRUNCATE); tabel anak lewat
//                daftar sesi/nis/username milik yayasan ini.
//     - insert : setiap baris divalidasi (yayasan_id, kepemilikan sesi/nis,
//                dan kunci utama yang tidak boleh sudah dipakai yayasan lain).
//     - storage: hanya folder/file milik yayasan ini.
//     - maintenance & penanda proses: per yayasan (tabel pengaturan ber-scope).
//   Logika ada di src/lib/backup-yayasan.ts dan src/lib/reset-yayasan.ts.
//
// PROTOKOL (semua POST JSON, hanya ADMIN):
//   { action:'start',  force?, allow_incomplete?, meta }  → plan / 409 / 412 / 422
//   { action:'clear',  table }
//   { action:'insert', table, rows }
//   { action:'storage-init',  bucket }
//   { action:'storage-put',   bucket, path, contentType, base64 }
//   { action:'storage-prune', bucket, keep: string[] }
//   { action:'finish' }
// =============================================================================

function res(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'error'
}

// ── clear ────────────────────────────────────────────────────────────────────
// Mengembalikan pesan error, atau null kalau sukses / tabel memang tidak ada.
// Hanya menghapus baris milik yayasan di `ls` (tidak ada TRUNCATE). Folder gambar
// soal di Storage SENGAJA tidak dihapus di sini (diganti storage-put lalu
// storage-prune); foto essay milik baris yang dihapus tetap ikut dihapus.
async function clearTable(ls: LingkupYayasan, table: string): Promise<string | null> {
  if (!SCHEMA_TABLES.has(table)) return null
  return hapusTabelYayasan(ls, table, {
    termasukSiswa: true,
    storageSelesai: new Set<string>(),
    lewatiStorageFolder: true,
  })
}

// ── handler tiap action ──────────────────────────────────────────────────────
interface StartMeta {
  app?: string
  version?: string
  backup_errors?: unknown
  /** Yayasan asal file backup (format 2.1+). Backup lama tidak memilikinya. */
  yayasan_id?: unknown
  row_counts?: Record<string, number>
  actual_counts?: Record<string, number>
}

async function actionStart(ls: LingkupYayasan, body: Record<string, unknown>) {
  const db = ls.db // terkunci ke yayasan si admin
  const force = body.force === true
  const allowIncomplete = body.allow_incomplete === true
  const meta = (body.meta ?? {}) as StartMeta
  const actual = meta.actual_counts

  // 1. Format dasar
  if (meta.app && meta.app !== 'SmartExam') {
    return res({ error: 'File backup bukan dari aplikasi SmartExam.' }, 400)
  }
  if (!actual || typeof actual !== 'object') {
    return res({ error: 'Format permintaan restore tidak valid (meta.actual_counts hilang).' }, 400)
  }
  const major = Number.parseInt(String(meta.version ?? '1').split('.')[0], 10)
  if (Number.isFinite(major) && major > 2) {
    return res(
      { error: `File backup dibuat oleh versi aplikasi yang lebih baru (format ${meta.version}). Perbarui aplikasi dulu.` },
      400
    )
  }

  const tablesInBackup = Object.keys(actual).filter(t => SCHEMA_TABLES.has(t))
  if (tablesInBackup.length === 0) {
    return res(
      { error: 'File backup tidak mengandung data yang dikenali. Pastikan file adalah backup SmartExam yang valid.' },
      400
    )
  }

  // 1b. Hanya tabel yang bisa dibatasi ke satu yayasan yang boleh dipulihkan.
  const tidakAman = tabelBackupTidakAman(tablesInBackup)
  if (tidakAman) {
    return res({ error: `Restore dibatalkan: tabel "${tidakAman}" belum bisa dibatasi ke satu yayasan.` }, 500)
  }

  // 1c. File backup harus berasal dari yayasan ini. Restore memang hanya
  //     menyentuh yayasan si admin, tapi memulihkan backup yayasan lain ke
  //     sini akan mengisi yayasan ini dengan data orang lain (atau gagal di
  //     tengah jalan). Backup lama (sebelum format 2.1) tidak punya penanda
  //     yayasan; semuanya dibuat saat hanya ada yayasan awal, jadi hanya boleh
  //     dipulihkan ke yayasan awal. Pemeriksaan per baris tetap dilakukan di
  //     action `insert`, jadi ini bukan satu-satunya pengaman.
  if (meta.yayasan_id != null && meta.yayasan_id !== '') {
    if (meta.yayasan_id !== ls.yayasanId) {
      return res(
        {
          error: `File backup ini milik yayasan lain (${String(meta.yayasan_id)}), bukan yayasan Anda. Restore dibatalkan sebelum menghapus apa pun.`,
          backup_yayasan_lain: true,
        },
        403
      )
    }
  } else if (ls.yayasanId !== YAYASAN_AWAL_ID) {
    return res(
      {
        error:
          'File backup ini berasal dari versi lama dan tidak mencantumkan yayasan asalnya, sehingga hanya boleh dipulihkan ke yayasan awal. Buat backup baru dari yayasan Anda untuk dipulihkan di sini. Restore dibatalkan sebelum menghapus apa pun.',
        backup_tanpa_yayasan: true,
      },
      403
    )
  }

  // 2. Backup yang sejak awal tidak lengkap. Backup versi lama tetap
  //    mengembalikan HTTP 200 walau sebagian tabel gagal dibaca, dan restore
  //    lama tidak pernah melihat field `errors` itu — sehingga data produksi
  //    dihapus lalu diganti data yang bolong.
  const backupErrors = Array.isArray(meta.backup_errors) ? (meta.backup_errors as unknown[]) : []
  if (backupErrors.length > 0 && !allowIncomplete) {
    return res(
      {
        error:
          'File backup ini TIDAK LENGKAP (saat dibuat ada bagian yang gagal diambil). Restore dibatalkan sebelum menghapus apa pun.',
        backup_tidak_lengkap: true,
        detail: backupErrors.slice(0, 10),
      },
      422
    )
  }

  // 3. Integritas file: jumlah baris yang tercatat harus sama dengan isi
  //    sebenarnya (mendeteksi file terpotong / diedit / rusak).
  const rc = meta.row_counts
  if (rc && typeof rc === 'object') {
    const mismatch: string[] = []
    for (const t of tablesInBackup) {
      const expected = rc[t]
      if (typeof expected === 'number' && expected !== actual[t]) {
        mismatch.push(`${t}: tercatat ${expected}, isi file ${actual[t]}`)
      }
    }
    if (mismatch.length > 0) {
      return res(
        {
          error: 'File backup rusak atau terpotong (jumlah baris tidak cocok dengan yang tercatat). Restore dibatalkan sebelum menghapus apa pun.',
          detail: mismatch,
        },
        422
      )
    }
  }

  // 4. Sesi ujian aktif — hanya milik yayasan ini (ujian yayasan lain tidak
  //    memblokir restore Anda dan tidak terpengaruh oleh restore ini).
  const akt = await cekAktivitasUjianYayasan(ls)
  if (akt.error) return res({ error: `Gagal memeriksa sesi ujian aktif: ${akt.error}` }, 500)
  if ((akt.adaSesi || akt.adaSiswa) && !force) {
    const pesan: string[] = []
    if (akt.adaSesi) pesan.push('ada sesi ujian yang sedang berjalan')
    if (akt.adaSiswa) pesan.push('ada siswa yang sedang mengerjakan ujian')
    return res(
      {
        error: `Restore tidak bisa dilakukan karena ${pesan.join(' dan ')}. Tutup semua sesi terlebih dahulu, atau konfirmasi restore paksa.`,
        ada_aktivitas: true,
        ada_sesi: akt.adaSesi,
        ada_siswa: akt.adaSiswa,
      },
      409
    )
  }

  // 5. Prasyarat database: fungsi sinkronisasi sequence (migrasi 22). Dicek
  //    SEKARANG (sebelum menghapus apa pun) — memanggilnya di data lama tidak
  //    berbahaya, ia hanya menyetel sequence ke MAX(id)+1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: fnErr } = await (db as any).rpc('sinkron_sequence_setelah_restore')
  if (fnErr) {
    return res(
      {
        error:
          'Migrasi database belum dijalankan: jalankan file supabase/22_perbaikan_backup_restore_reset.sql di Supabase SQL Editor, lalu coba restore lagi. Tanpa itu, restore akan membuat penyimpanan jawaban gagal (duplicate key). Belum ada data yang diubah.',
        butuh_migrasi: true,
        detail: fnErr.message,
      },
      412
    )
  }

  // 6. FIX (audit brief bagian N): DETEKSI RESTORE/RESET SEBELUMNYA YANG
  //    TERPUTUS. Penanda "sedang berjalan" yang masih menyala berarti proses
  //    sebelumnya tidak pernah mencapai `finish` — database mungkin dalam
  //    kondisi campuran yang tidak konsisten. Tolak dulu (kecuali force)
  //    supaya admin sadar & memeriksa manual sebelum restore baru menimpanya
  //    lagi tanpa disadari. Dicek di sini (BELUM ada data yang diubah).
  if (!force) {
    const prosesSebelumnya = await cekProsesDataBesarBerjalan(db)
    if (prosesSebelumnya.sedangBerjalan) {
      return res(
        {
          error: `Proses ${prosesSebelumnya.jenis ?? 'reset/restore'} sebelumnya (dimulai ${prosesSebelumnya.mulaiPada ?? 'waktu tidak diketahui'}) tampak TIDAK PERNAH SELESAI — kemungkinan terputus di tengah jalan (tab tertutup, koneksi putus, server restart). Database mungkin berada dalam kondisi tidak konsisten. Periksa data secara manual dulu sebelum melanjutkan, atau konfirmasi paksa untuk tetap lanjut.`,
          proses_sebelumnya_belum_selesai: true,
          proses_sebelumnya: prosesSebelumnya,
        },
        409
      )
    }
  }

  // 7. FIX (audit brief bagian N): nyalakan mode maintenance sendiri TEPAT
  //    di sini — titik terakhir sebelum client mulai memanggil `clear`/
  //    `insert` yang benar-benar mengubah data. Dimatikan lagi di
  //    actionFinish() di bawah.
  //
  //    FIX P0 (audit: token proses): token yang diterbitkan di sini HARUS
  //    disertakan & cocok di setiap panggilan clear/insert/storage-*/finish
  //    berikutnya (lihat requireProcessToken di bawah) — tanpa ini, action-
  //    action tersebut bisa dipanggil langsung tanpa pernah melalui validasi
  //    di atas sama sekali. Lihat catatan panjang di
  //    backup-restore-shared.ts pada PENGATURAN_KEY_PROSES_TOKEN.
  //    Maintenance & penanda proses disimpan per yayasan (tabel pengaturan
  //    lewat tenantDb), jadi yayasan lain tidak ikut masuk mode maintenance.
  //    Target konflik 'yayasan_id,key': kunci utama pengaturan sejak migrasi 43.
  const token = await mulaiModeMaintenanceUntukProses(db, 'restore', ON_CONFLICT_PENGATURAN)

  return res({
    ok: true,
    token,
    delete_order: DELETE_ORDER.filter(t => tablesInBackup.includes(t)),
    insert_order: INSERT_ORDER.filter(t => tablesInBackup.includes(t)),
    ada_aktivitas: akt.adaSesi || akt.adaSiswa,
    yayasan_id: ls.yayasanId,
  })
}

// FIX P0 (audit: actionClear/actionInsert tidak terikat proses `start`):
// dipanggil di awal SETIAP action selain `start` yang benar-benar mengubah
// data (clear, insert, storage-init, storage-put, storage-prune, finish).
// Mengembalikan NextResponse error (409) kalau token tidak ada/tidak cocok/
// proses restore tidak sedang berjalan — caller WAJIB return langsung hasil
// ini tanpa melanjutkan ke operasi aslinya.
async function requireProcessToken(db: Db, body: Record<string, unknown>) {
  const valid = await verifikasiTokenProses(db, 'restore', body.token)
  if (!valid) {
    return res(
      {
        error:
          'Tidak ada proses restore yang sedang berjalan (atau token tidak cocok/sudah kedaluwarsa). Mulai ulang restore dari awal (action "start").',
        proses_tidak_valid: true,
      },
      409
    )
  }
  return null
}

async function actionClear(ls: LingkupYayasan, body: Record<string, unknown>) {
  const gate = await requireProcessToken(ls.db, body)
  if (gate) return gate
  const table = String(body.table ?? '')
  if (!SCHEMA_TABLES.has(table)) return res({ error: `Tabel "${table}" tidak dikenali` }, 400)
  const err = await clearTable(ls, table)
  if (err) return res({ error: err }, 500)
  return res({ ok: true, table })
}

async function actionInsert(ls: LingkupYayasan, body: Record<string, unknown>) {
  const gate = await requireProcessToken(ls.db, body)
  if (gate) return gate
  const table = String(body.table ?? '')
  if (!SCHEMA_TABLES.has(table)) return res({ error: `Tabel "${table}" tidak dikenali` }, 400)
  if (!Array.isArray(body.rows)) return res({ error: 'rows harus berupa array' }, 400)

  let rows = body.rows as Record<string, unknown>[]
  // Akun ADMIN tidak dihapus saat clear, jadi jangan di-insert lagi (duplicate key).
  if (table === 'users') rows = rows.filter(r => r?.role !== 'ADMIN')
  // FIX: kunci pengaturan yang dilindungi tidak boleh ditimpa dari file backup:
  // penanda proses & maintenanceAktif (lihat KUNCI_PENGATURAN_DILINDUNGI_RESTORE)
  // dan kunci maintenance milik Panel Developer (lihat reset-yayasan.ts).
  if (table === 'pengaturan') {
    rows = rows.filter(r => !KUNCI_PENGATURAN_DIPERTAHANKAN.includes(String(r?.key)))
  }
  if (rows.length === 0) return res({ ok: true, table, inserted: 0 })

  // Setiap baris harus milik yayasan ini dan tidak boleh menimpa data yayasan
  // lain (kunci utama id/nis/username masih global). Satu baris menyimpang =
  // seluruh batch ditolak, tidak ada yang ditulis.
  const errValidasi = await validasiBarisRestore(ls, table, rows)
  if (errValidasi) return res({ error: `Gagal insert ${errValidasi}`, ditolak_lintas_yayasan: true }, 403)

  // upsert (bukan insert) supaya batch yang dikirim ulang setelah gangguan
  // jaringan — padahal server sudah sempat memprosesnya — tidak gagal
  // "duplicate key". Tabel sudah dikosongkan, jadi hasilnya identik dengan insert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Lewat tenantDb: yayasan_id diisi otomatis dan baris yayasan lain ditolak.
  const { error } = await (ls.db as any)
    .from(table)
    .upsert(rows, { onConflict: onConflictOf(table) })

  if (error) return res({ error: `Gagal insert ${table}: ${error.message}` }, 500)
  return res({ ok: true, table, inserted: rows.length })
}

async function actionStorageInit(ls: LingkupYayasan, body: Record<string, unknown>) {
  const db = ls.db
  const gate = await requireProcessToken(db, body)
  if (gate) return gate
  const bucket = String(body.bucket ?? '')
  if (!isKnownBucket(bucket)) return res({ error: 'Bucket tidak dikenali' }, 400)

  const { error } = await db.storage.getBucket(bucket)
  if (!error) return res({ ok: true, created: false })

  if (!isBucketMissingError(error.message) && !/not found/i.test(error.message)) {
    return res({ error: `storage/${bucket}: ${error.message}` }, 500)
  }
  // Restore ke project baru: bucket belum ada → buat dengan visibilitas yang sama
  // seperti aslinya (assets publik karena URL-nya dipakai langsung di halaman;
  // jawaban-essay privat karena dibaca lewat signed URL).
  const publik = BACKUP_BUCKETS.find(b => b.name === bucket)?.public ?? false
  const created = await db.storage.createBucket(bucket, { public: publik })
  if (created.error) return res({ error: `storage/${bucket}: ${created.error.message}` }, 500)
  return res({ ok: true, created: true })
}

async function actionStoragePut(ls: LingkupYayasan, body: Record<string, unknown>) {
  const db = ls.db
  const gate = await requireProcessToken(db, body)
  if (gate) return gate
  const bucket = String(body.bucket ?? '')
  const path = body.path
  const base64 = body.base64
  if (!isKnownBucket(bucket)) return res({ error: 'Bucket tidak dikenali' }, 400)
  if (!isSafeStoragePath(path)) return res({ error: 'Path file tidak valid' }, 400)
  // Hanya boleh menulis ke folder/file milik yayasan ini (bukan folder yayasan
  // lain atau logo aplikasi). Foto essay harus dirujuk baris milik yayasan ini
  // — baris itu sudah di-insert sebelum langkah storage.
  if (!(await fileStorageMilikYayasan(ls, bucket, path))) {
    return res({ error: `${bucket}/${path}: bukan file milik yayasan ini, tidak dipulihkan` }, 403)
  }
  if (typeof base64 !== 'string') return res({ error: 'base64 hilang' }, 400)
  if (base64.length > MAX_ASSET_BASE64_CHARS) {
    return res({ error: `${bucket}/${path}: file terlalu besar untuk dipulihkan lewat aplikasi` }, 413)
  }

  const contentType =
    typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream'
  const { error } = await db.storage
    .from(bucket)
    .upload(path, Buffer.from(base64, 'base64'), { contentType, upsert: true })
  if (error) return res({ error: `${bucket}/${path}: ${error.message}` }, 500)
  return res({ ok: true })
}

async function actionStoragePrune(ls: LingkupYayasan, body: Record<string, unknown>) {
  const db = ls.db
  const gate = await requireProcessToken(db, body)
  if (gate) return gate
  const bucket = String(body.bucket ?? '')
  if (!isKnownBucket(bucket)) return res({ error: 'Bucket tidak dikenali' }, 400)
  if (!Array.isArray(body.keep)) return res({ error: 'keep harus berupa array' }, 400)

  const keep = new Set((body.keep as unknown[]).filter((p): p is string => typeof p === 'string'))

  // Hanya file di folder milik yayasan ini (soal & logo) yang dibersihkan.
  // Foto essay lama sudah ikut terhapus saat tabel jawaban_essay_foto
  // dikosongkan (action clear), jadi bucket privat tidak perlu dibersihkan lagi.
  // Bucket dibaca lewat daftarStorageYayasan, bukan listing seluruh bucket,
  // supaya file yayasan lain tidak pernah terdaftar sebagai "sisa lama".
  if (bucket !== 'assets') return res({ ok: true, removed: 0 })
  const daftar = await daftarStorageYayasan(ls)
  if (daftar.errors.length > 0) return res({ error: daftar.errors[0] }, 500)

  const stale = daftar.folderAssets.filter(p => !keep.has(p))
  if (stale.length > 0) {
    const err = await removeFilesInChunks(db, bucket, stale)
    if (err) return res({ error: err }, 500)
  }
  return res({ ok: true, removed: stale.length })
}

async function actionFinish(ls: LingkupYayasan, body: Record<string, unknown>) {
  const db = ls.db
  const gate = await requireProcessToken(db, body)
  if (gate) return gate
  const warnings: string[] = []

  // Setel ulang sequence BIGSERIAL ke MAX(id)+1 — lihat catatan #3 di atas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).rpc('sinkron_sequence_setelah_restore')
  if (error) {
    warnings.push(
      `PENTING: sinkronisasi sequence gagal (${error.message}). Jalankan SELECT sinkron_sequence_setelah_restore(); di Supabase SQL Editor sebelum ujian berikutnya, kalau tidak penyimpanan jawaban bisa gagal.`
    )
  }

  // FIX (audit brief bagian N): matikan mode maintenance yang dinyalakan
  // sendiri di actionStart() — dikembalikan ke nilai SEBELUM restore dimulai,
  // bukan dipaksa 'false', dan hapus penanda "sedang berjalan". Ini titik
  // yang menandai restore benar-benar tuntas; kalau titik ini tidak pernah
  // tercapai (client tidak pernah memanggil `finish`), penanda tetap menyala
  // dengan sengaja — itulah sinyal "restore terputus" untuk percobaan
  // `start` berikutnya (lihat cekProsesDataBesarBerjalan di actionStart).
  await selesaiModeMaintenanceUntukProses(db, ON_CONFLICT_PENGATURAN)

  // In-memory cache (lib/cache.ts) berisi data lama sampai TTL habis.
  // Kunci dashboard/laporan memuat id yayasan (admin:dashboard:<id>), jadi harus
  // dihapus lewat prefix — cacheDel('admin:dashboard') polos tidak cocok apa pun.
  cacheDelPrefix('admin:dashboard:')
  cacheDelPrefix('admin:laporan-lengkap:')
  cacheDelPrefix('pengaturan:')

  return res({ ok: true, warnings })
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  // Yayasan ditentukan dari token admin yang login, BUKAN dari isi request.
  let ls: LingkupYayasan
  try {
    ls = buatLingkupYayasan(yayasanIdDari(auth.user))
  } catch (e) {
    return res({ error: e instanceof Error ? e.message : 'Silakan login ulang.' }, 401)
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return res(
      { error: 'Format permintaan tidak didukung. Muat ulang halaman admin (versi aplikasi di browser sudah usang) lalu coba lagi.' },
      415
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return res({ error: 'Permintaan tidak valid (bukan JSON).' }, 400)
  }

  try {
    switch (body.action) {
      case 'start':
        return await actionStart(ls, body)
      case 'clear':
        return await actionClear(ls, body)
      case 'insert':
        return await actionInsert(ls, body)
      case 'storage-init':
        return await actionStorageInit(ls, body)
      case 'storage-put':
        return await actionStoragePut(ls, body)
      case 'storage-prune':
        return await actionStoragePrune(ls, body)
      case 'finish':
        return await actionFinish(ls, body)
      default:
        return res({ error: 'Action tidak dikenali' }, 400)
    }
  } catch (e) {
    return res({ error: errMsg(e) }, 500)
  }
}
