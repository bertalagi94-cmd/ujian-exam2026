import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  BACKUP_BUCKETS,
  BACKUP_TABLES,
  MAX_ASSET_BYTES,
  cekAktivitasUjian,
  isKnownBucket,
  isMissingTableError,
  isSafeStoragePath,
  listBucketFiles,
  pkOf,
} from '@/lib/backup-restore-shared'

// =============================================================================
// BACKUP — API BERTAHAP (dipanggil berulang dari browser)
//
// KENAPA DIUBAH: versi lama membuat SELURUH backup (semua tabel + semua file
// storage dalam base64) di satu request lalu mengirimnya sebagai satu response
// JSON. Dengan data nyata (tabel `jawaban` saja 33.196 baris ≈ 10 MB) ini:
//   1. melewati batas body response Vercel (~4,5 MB) → gagal 413, dan
//   2. berisiko melewati maxDuration 60 detik, dan
//   3. menghasilkan file yang TIDAK BISA direstore lewat UI (UI membatasi
//      restore 4 MB), jadi backup-nya sendiri praktis tidak berguna.
//
// SEKARANG browser yang merakit file backup dari banyak request kecil:
//
//   GET ?mode=plan[&force=1]
//        → daftar tabel + jumlah baris, daftar file storage. Di sini juga
//          dilakukan pengecekan sesi ujian aktif (409 kalau ada, kecuali force).
//   GET ?table=<nama>&from=<offset>&limit=<n>
//        → satu halaman baris (dipangkas otomatis agar < ~3,5 MB).
//   GET ?bucket=<nama>&file=<path>
//        → satu file storage sebagai base64.
//
// Format file backup versi 2.0 (dirakit di src/lib/backup-restore-client.ts):
//   { version, app, exported_at, errors?, row_counts, tables:{...},
//     storage:{ buckets:{ assets:[...], 'jawaban-essay':[...] } } }
// `errors` TIDAK kosong berarti backup tidak lengkap; restore menolaknya kecuali
// admin secara eksplisit mengizinkan.
// =============================================================================

// Supabase/PostgREST membatasi setiap query ke 1000 baris (db-max-rows).
const MAX_PAGE_ROWS = 1000
// Batas ukuran satu response halaman (Vercel ±4,5 MB, sisakan ruang).
const MAX_PAGE_BYTES = 3_500_000

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function toInt(v: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}

// ── GET ?mode=plan ───────────────────────────────────────────────────────────
async function handlePlan(req: NextRequest) {
  const db = createAdminClient()
  const force = req.nextUrl.searchParams.get('force') === '1'

  // Backup saat ujian berjalan berisiko tidak konsisten (jawaban belum
  // tersimpan, nilai belum dihitung). Sama seperti restore/reset: ditolak
  // kecuali admin sadar dan memaksa.
  const akt = await cekAktivitasUjian(db)
  if (akt.error) {
    return noStore({ error: `Gagal memeriksa sesi ujian aktif: ${akt.error}` }, 500)
  }
  if ((akt.adaSesi || akt.adaSiswa) && !force) {
    const pesan: string[] = []
    if (akt.adaSesi) pesan.push('ada sesi ujian yang sedang berjalan')
    if (akt.adaSiswa) pesan.push('ada siswa yang sedang mengerjakan ujian')
    return noStore(
      {
        error: `Backup sebaiknya tidak dilakukan karena ${pesan.join(' dan ')} — data backup bisa tidak konsisten. Tutup semua sesi terlebih dahulu.`,
        ada_aktivitas: true,
        ada_sesi: akt.adaSesi,
        ada_siswa: akt.adaSiswa,
      },
      409
    )
  }

  const warnings: string[] = []
  const tables: { name: string; count: number }[] = []

  const counts = await Promise.all(
    BACKUP_TABLES.map(async name => {
      const { count, error } = await db.from(name).select('*', { count: 'exact', head: true })
      return { name, count, error }
    })
  )

  for (const c of counts) {
    if (c.error) {
      if (isMissingTableError(c.error.message)) {
        // Tabel belum ada di database ini (mis. migrasi belum dijalankan).
        // Bukan kegagalan backup, tapi admin perlu tahu.
        warnings.push(`Tabel "${c.name}" tidak ada di database ini dan dilewati.`)
        continue
      }
      // Gagal menghitung tabel yang seharusnya ada = backup TIDAK boleh
      // dilanjutkan, kalau tidak hasilnya diam-diam bolong.
      return noStore({ error: `Gagal membaca tabel ${c.name}: ${c.error.message}` }, 500)
    }
    tables.push({ name: c.name, count: c.count ?? 0 })
  }

  const buckets: Record<string, { path: string }[]> = {}
  const storageErrors: string[] = []
  for (const b of BACKUP_BUCKETS) {
    const listed = await listBucketFiles(db, b.name)
    if (listed.bucketMissing) {
      buckets[b.name] = []
      continue
    }
    if (listed.error) storageErrors.push(`storage/${listed.error}`)
    buckets[b.name] = listed.paths.map(path => ({ path }))
  }

  return noStore({
    exported_at: new Date().toISOString(),
    page_size: MAX_PAGE_ROWS,
    tables,
    storage: { buckets, errors: storageErrors },
    warnings,
    ada_aktivitas: akt.adaSesi || akt.adaSiswa,
  })
}

// ── GET ?table=...&from=...&limit=... ────────────────────────────────────────
async function handleTablePage(req: NextRequest, table: string) {
  if (!BACKUP_TABLES.includes(table)) {
    return noStore({ error: `Tabel "${table}" tidak dikenali` }, 400)
  }
  const db = createAdminClient()
  const from = toInt(req.nextUrl.searchParams.get('from'), 0, 0, 100_000_000)
  const limit = toInt(req.nextUrl.searchParams.get('limit'), MAX_PAGE_ROWS, 1, MAX_PAGE_ROWS)

  // ORDER BY seluruh kolom primary key → urutan stabil untuk paginasi offset.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db.from(table).select('*')
  for (const col of pkOf(table)) q = q.order(col, { ascending: true })
  const { data, error } = await q.range(from, from + limit - 1)

  if (error) return noStore({ error: `${table}: ${error.message}` }, 500)

  let rows = (data ?? []) as unknown[]

  // Pangkas kalau baris-barisnya besar (mis. soal dengan teks panjang) supaya
  // response tetap di bawah batas Vercel. Klien melanjutkan dari
  // from + rows.length, jadi tidak ada baris yang terlewat.
  let bytes = JSON.stringify(rows).length
  while (bytes > MAX_PAGE_BYTES && rows.length > 1) {
    rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)))
    bytes = JSON.stringify(rows).length
  }
  if (bytes > 4_300_000) {
    return noStore(
      { error: `${table}: satu baris berukuran ${(bytes / 1024 / 1024).toFixed(1)} MB, terlalu besar untuk di-backup lewat aplikasi` },
      413
    )
  }

  return noStore({ table, from, rows })
}

// ── GET ?bucket=...&file=... ─────────────────────────────────────────────────
async function handleFile(bucket: string, file: string) {
  if (!isKnownBucket(bucket)) return noStore({ error: 'Bucket tidak dikenali' }, 400)
  if (!isSafeStoragePath(file)) return noStore({ error: 'Path file tidak valid' }, 400)

  const db = createAdminClient()
  const { data, error } = await db.storage.from(bucket).download(file)
  if (error || !data) {
    return noStore({ error: `${bucket}/${file}: ${error?.message ?? 'gagal mengunduh file'}` }, 500)
  }
  if (data.size > MAX_ASSET_BYTES) {
    return noStore({
      skipped: true,
      path: file,
      size: data.size,
      reason: `${bucket}/${file}: dilewati, ukuran ${(data.size / 1024 / 1024).toFixed(1)}MB melebihi batas ${MAX_ASSET_BYTES / 1024 / 1024}MB`,
    })
  }

  const buffer = Buffer.from(await data.arrayBuffer())
  return noStore({
    path: file,
    contentType: data.type || 'application/octet-stream',
    base64: buffer.toString('base64'),
  })
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const sp = req.nextUrl.searchParams
  try {
    const table = sp.get('table')
    if (table) return await handleTablePage(req, table)

    const bucket = sp.get('bucket')
    const file = sp.get('file')
    if (bucket && file) return await handleFile(bucket, file)

    return await handlePlan(req)
  } catch (e) {
    return noStore({ error: e instanceof Error ? e.message : 'Backup gagal' }, 500)
  }
}
