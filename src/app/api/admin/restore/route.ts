import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cacheDel, cacheDelPrefix } from '@/lib/cache'
import {
  BACKUP_BUCKETS,
  DELETE_ORDER,
  INSERT_ORDER,
  MAX_ASSET_BASE64_CHARS,
  SCHEMA_TABLES,
  TRUNCATE_TABLES,
  cekAktivitasUjian,
  cekProsesDataBesarBerjalan,
  isBucketMissingError,
  isKnownBucket,
  isMissingTableError,
  isSafeStoragePath,
  listBucketFiles,
  mulaiModeMaintenanceUntukProses,
  pkOf,
  removeFilesInChunks,
  selesaiModeMaintenanceUntukProses,
  type Db,
} from '@/lib/backup-restore-shared'

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
async function clearTable(db: Db, table: string): Promise<string | null> {
  if (!SCHEMA_TABLES.has(table)) return null

  try {
    // Tabel besar → TRUNCATE lewat RPC (cepat, tidak timeout).
    if (TRUNCATE_TABLES.has(table)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).rpc('truncate_tabel_besar', { nama_tabel: table })
      if (!error) return null
      if (isMissingTableError(error.message)) return null
      // Fungsi belum diperbarui (migrasi 22 belum jalan) → jatuh ke DELETE biasa.
      // Untuk tabel kecil/menengah ini tetap benar, hanya lebih lambat.
      if (!/tidak diizinkan|truncate_tabel_besar/i.test(error.message)) {
        return `${table}: ${error.message}`
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).delete()
    if (table === 'users') {
      // Akun ADMIN sengaja tidak dihapus supaya admin yang sedang login tidak
      // terkunci di tengah proses.
      q = q.neq('role', 'ADMIN')
    } else {
      // `NOT (kolom IS NULL)` valid untuk semua tipe kolom PK (TEXT & BIGINT).
      q = q.not(pkOf(table)[0], 'is', null)
    }
    const { error } = await q
    if (error) {
      if (isMissingTableError(error.message)) return null
      return `${table}: ${error.message}`
    }
    return null
  } catch (e) {
    const msg = errMsg(e)
    if (isMissingTableError(msg)) return null
    return `${table}: ${msg}`
  }
}

// ── handler tiap action ──────────────────────────────────────────────────────
interface StartMeta {
  app?: string
  version?: string
  backup_errors?: unknown
  row_counts?: Record<string, number>
  actual_counts?: Record<string, number>
}

async function actionStart(db: Db, body: Record<string, unknown>) {
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

  // 4. Sesi ujian aktif
  const akt = await cekAktivitasUjian(db)
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
  await mulaiModeMaintenanceUntukProses(db, 'restore')

  return res({
    ok: true,
    delete_order: DELETE_ORDER.filter(t => tablesInBackup.includes(t)),
    insert_order: INSERT_ORDER.filter(t => tablesInBackup.includes(t)),
    ada_aktivitas: akt.adaSesi || akt.adaSiswa,
  })
}

async function actionClear(db: Db, body: Record<string, unknown>) {
  const table = String(body.table ?? '')
  if (!SCHEMA_TABLES.has(table)) return res({ error: `Tabel "${table}" tidak dikenali` }, 400)
  const err = await clearTable(db, table)
  if (err) return res({ error: err }, 500)
  return res({ ok: true, table })
}

async function actionInsert(db: Db, body: Record<string, unknown>) {
  const table = String(body.table ?? '')
  if (!SCHEMA_TABLES.has(table)) return res({ error: `Tabel "${table}" tidak dikenali` }, 400)
  if (!Array.isArray(body.rows)) return res({ error: 'rows harus berupa array' }, 400)

  let rows = body.rows as Record<string, unknown>[]
  // Akun ADMIN tidak dihapus saat clear, jadi jangan di-insert lagi (duplicate key).
  if (table === 'users') rows = rows.filter(r => r?.role !== 'ADMIN')
  if (rows.length === 0) return res({ ok: true, table, inserted: 0 })

  // upsert (bukan insert) supaya batch yang dikirim ulang setelah gangguan
  // jaringan — padahal server sudah sempat memprosesnya — tidak gagal
  // "duplicate key". Tabel sudah dikosongkan, jadi hasilnya identik dengan insert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from(table)
    .upsert(rows, { onConflict: pkOf(table).join(',') })

  if (error) return res({ error: `Gagal insert ${table}: ${error.message}` }, 500)
  return res({ ok: true, table, inserted: rows.length })
}

async function actionStorageInit(db: Db, body: Record<string, unknown>) {
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

async function actionStoragePut(db: Db, body: Record<string, unknown>) {
  const bucket = String(body.bucket ?? '')
  const path = body.path
  const base64 = body.base64
  if (!isKnownBucket(bucket)) return res({ error: 'Bucket tidak dikenali' }, 400)
  if (!isSafeStoragePath(path)) return res({ error: 'Path file tidak valid' }, 400)
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

async function actionStoragePrune(db: Db, body: Record<string, unknown>) {
  const bucket = String(body.bucket ?? '')
  if (!isKnownBucket(bucket)) return res({ error: 'Bucket tidak dikenali' }, 400)
  if (!Array.isArray(body.keep)) return res({ error: 'keep harus berupa array' }, 400)

  const keep = new Set((body.keep as unknown[]).filter((p): p is string => typeof p === 'string'))
  const listed = await listBucketFiles(db, bucket)
  if (listed.bucketMissing) return res({ ok: true, removed: 0 })
  if (listed.error) return res({ error: listed.error }, 500)

  const stale = listed.paths.filter(p => !keep.has(p))
  if (stale.length > 0) {
    const err = await removeFilesInChunks(db, bucket, stale)
    if (err) return res({ error: err }, 500)
  }
  return res({ ok: true, removed: stale.length })
}

async function actionFinish(db: Db) {
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
  await selesaiModeMaintenanceUntukProses(db)

  // In-memory cache (lib/cache.ts) berisi data lama sampai TTL habis.
  cacheDel('admin:dashboard')
  cacheDelPrefix('pengaturan:')

  return res({ ok: true, warnings })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

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

  const db = createAdminClient()
  try {
    switch (body.action) {
      case 'start':
        return await actionStart(db, body)
      case 'clear':
        return await actionClear(db, body)
      case 'insert':
        return await actionInsert(db, body)
      case 'storage-init':
        return await actionStorageInit(db, body)
      case 'storage-put':
        return await actionStoragePut(db, body)
      case 'storage-prune':
        return await actionStoragePrune(db, body)
      case 'finish':
        return await actionFinish(db)
      default:
        return res({ error: 'Action tidak dikenali' }, 400)
    }
  } catch (e) {
    return res({ error: errMsg(e) }, 500)
  }
}
