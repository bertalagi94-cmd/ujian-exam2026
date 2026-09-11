import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// BUG FIX: tabel `kisi_kisi` sebelumnya dianggap "DIHAPUS - tidak ada di
// 01_schema.sql", padahal itu cuma tidak pernah tercatat di file schema
// (schema file-nya yang telat diupdate, bukan tabelnya yang hilang).
// Tabel ini aktif dipakai di src/app/api/{admin,guru,siswa}/kisi-kisi dan
// nyata ada datanya di database produksi — sebelum fix ini, data kisi-kisi
// TIDAK IKUT TER-BACKUP sama sekali. Sudah diverifikasi manual di Supabase
// (02 Jul 2026): tidak ada FK/trigger/RPC yang bergantung padanya, jadi
// aman diperlakukan sama seperti tabel lain di sini.
// BUG FIX (fitur Soal Essay tidak ikut ter-backup): sama persis dengan bug
// `kisi_kisi` yang sudah pernah diperbaiki di sini — tabel-tabel essay
// (`paket_essay`, `soal_essay`, `jawaban_essay`, `jawaban_essay_foto`)
// ditambahkan lewat migrasi terpisah (07_essay.sql, 08_paket_essay.sql,
// setelah 01_schema.sql) dan TIDAK PERNAH dimasukkan ke daftar ini.
// Akibatnya: bank soal essay & jawaban essay siswa TIDAK IKUT TER-BACKUP
// sama sekali, padahal fitur Koreksi Essay sudah aktif dipakai. Kolom essay
// yang ditambahkan ke tabel yang SUDAH ada di daftar ini (jadwal, siswa_ujian,
// nilai) tetap ikut terbawa karena backup memakai select('*') — masalahnya
// murni 4 tabel BARU yang belum pernah didaftarkan.
const BACKUP_TABLES = [
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
  'jawaban',
  'jawaban_essay',
  'jawaban_essay_foto',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
]

// Kolom unik untuk ORDER BY saat paginasi tiap tabel (default 'id' kalau tidak
// disebutkan di sini). Wajib pakai kolom yang benar-benar unik & stabil agar
// paginasi .range() tidak melompati atau menduplikasi baris antar halaman.
const ORDER_COLUMN: Record<string, string> = {
  pengaturan: 'key',
  siswa: 'nis',
  users: 'username',
}

// FIX BUG FATAL: Supabase/PostgREST membatasi SETIAP query .select() ke maksimal
// 1000 baris secara default (db-max-rows) — TANPA error sama sekali kalau tabel
// punya lebih banyak baris dari itu, sisanya diam-diam tidak ikut terbawa.
//
// Endpoint ini sebelumnya hanya melakukan SATU query .select('*') per tabel,
// jadi untuk tabel besar (contoh nyata: tabel `jawaban` di data Anda sudah
// berisi 33.196 baris — lihat komentar di supabase/04_seed_jawaban.sql) backup
// yang dihasilkan hanya berisi ±1000 baris PERTAMA, kehilangan >96% datanya,
// tanpa peringatan apa pun ke admin. File backup tetap "berhasil" di-download
// padahal isinya sudah cacat — fatal khusus untuk fitur ini karena tujuannya
// justru disaster-recovery: kalau backup-nya sendiri sudah cacat, restore pun
// ikut membawa data yang cacat.
//
// FIX: ambil tiap tabel per halaman 1000 baris pakai .range(), diulang sampai
// jumlah baris yang kembali < ukuran halaman (berarti sudah halaman terakhir),
// lalu digabungkan jadi satu array lengkap.
const PAGE_SIZE = 1000

// ── Backup file di Supabase Storage (bucket "assets") ───────────────────────
// FIX (celah backup/restore): sebelumnya backup HANYA menyimpan baris database.
// Logo sekolah, logo aplikasi, dan gambar yang di-upload ke soal disimpan
// sebagai FILE BINER di Supabase Storage bucket "assets" (lihat
// admin/pengaturan/logo, admin/sekolah/logo, guru/soal/upload) — backup lama
// cuma menyimpan URL-nya (lewat kolom di tabel `pengaturan`/`sekolah`), bukan
// file aslinya. Kalau restore dilakukan ke project Supabase yang berbeda,
// URL itu jadi menunjuk ke file yang tidak ada sama sekali (broken image).
// Sekarang backup ikut mengunduh isi bucket, encode base64, dan menyimpannya
// di payload — supaya restore benar-benar bisa memulihkan file-nya juga.
const STORAGE_BUCKET = 'assets'
// Batas ukuran per file yang ikut di-backup. Upload gambar soal sudah dibatasi
// 2MB di endpoint uploadnya, tapi upload logo TIDAK dibatasi ukurannya —
// tanpa batas di sini, satu logo besar bisa membengkakkan file backup JSON
// (base64 menambah ~33% ukuran) tanpa peringatan apa pun ke admin.
const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

interface StorageAsset {
  path: string
  contentType: string
  base64: string
}

async function listAllFiles(
  db: ReturnType<typeof createAdminClient>,
  bucket: string,
  prefix = ''
): Promise<string[]> {
  const LIMIT = 1000
  const paths: string[] = []
  let offset = 0

  while (true) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: LIMIT, offset, sortBy: { column: 'name', order: 'asc' } })

    if (error || !data) break

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name
      // Supabase Storage merepresentasikan sub-folder sebagai entry dengan
      // id === null (tidak ada metadata file) — perlu direkursi, bukan
      // diperlakukan sebagai file biasa.
      if (entry.id === null) {
        const nested = await listAllFiles(db, bucket, fullPath)
        paths.push(...nested)
      } else {
        paths.push(fullPath)
      }
    }

    if (data.length < LIMIT) break
    offset += LIMIT
  }

  return paths
}

async function backupStorageAssets(
  db: ReturnType<typeof createAdminClient>
): Promise<{ assets: StorageAsset[]; errors: string[] }> {
  const errors: string[] = []
  const assets: StorageAsset[] = []

  let paths: string[] = []
  try {
    paths = await listAllFiles(db, STORAGE_BUCKET)
  } catch (e) {
    errors.push(`listing bucket "${STORAGE_BUCKET}": ${e instanceof Error ? e.message : 'error'}`)
    return { assets, errors }
  }

  for (const path of paths) {
    try {
      const { data, error } = await db.storage.from(STORAGE_BUCKET).download(path)
      if (error || !data) {
        errors.push(`${path}: ${error?.message ?? 'gagal mengunduh file'}`)
        continue
      }
      if (data.size > MAX_ASSET_SIZE_BYTES) {
        errors.push(`${path}: dilewati, ukuran ${(data.size / 1024 / 1024).toFixed(1)}MB melebihi batas ${MAX_ASSET_SIZE_BYTES / 1024 / 1024}MB`)
        continue
      }
      const buffer = Buffer.from(await data.arrayBuffer())
      assets.push({
        path,
        contentType: data.type || 'application/octet-stream',
        base64: buffer.toString('base64'),
      })
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  return { assets, errors }
}

async function fetchAllRows(
  db: ReturnType<typeof createAdminClient>,
  table: string
): Promise<{ rows: unknown[]; error?: string }> {
  const orderCol = ORDER_COLUMN[table] ?? 'id'
  const allRows: unknown[] = []
  let from = 0

  while (true) {
    const { data, error } = await db
      .from(table as never)
      .select('*')
      .order(orderCol as never, { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      return { rows: allRows, error: error.message }
    }

    const batch = (data ?? []) as unknown[]
    allRows.push(...batch)

    if (batch.length < PAGE_SIZE) break // sudah halaman terakhir
    from += PAGE_SIZE
  }

  return { rows: allRows }
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // ── CEK AKTIVITAS SEBELUM BACKUP ────────────────────────────────────────
  // Backup saat ujian berjalan berisiko menghasilkan data tidak konsisten
  // (sebagian jawaban belum tersimpan, nilai belum dihitung). Tolak kecuali
  // tidak ada sesi aktif sama sekali.
  const { data: sesiAktif } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('status', 'BERJALAN')
    .limit(1)

  if (sesiAktif && sesiAktif.length > 0) {
    return NextResponse.json({
      error: 'Backup tidak bisa dilakukan saat ada sesi ujian yang sedang berjalan. Tutup semua sesi terlebih dahulu agar data backup konsisten.',
      ada_sesi: true,
    }, { status: 409 })
  }
  // ─────────────────────────────────────────────────────────────────────────

  const backupData: Record<string, unknown[]> = {}
  const errors: string[] = []

  for (const table of BACKUP_TABLES) {
    try {
      const { rows, error } = await fetchAllRows(db, table)
      backupData[table] = rows
      if (error) errors.push(`${table}: ${error}`)
    } catch (e) {
      errors.push(`${table}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      backupData[table] = []
    }
  }

  // Ambil file di Supabase Storage (logo & gambar soal) — lihat catatan di
  // backupStorageAssets(). Kegagalan di sini TIDAK menggagalkan backup data
  // tabel; dicatat sebagai warning di `errors` supaya admin tetap tahu.
  const { assets: storageAssets, errors: storageErrors } = await backupStorageAssets(db)
  if (storageErrors.length > 0) {
    errors.push(...storageErrors.map(e => `storage/${STORAGE_BUCKET}/${e}`))
  }

  const payload = {
    version: '1.1',
    app: 'SmartExam',
    exported_at: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
    // Jumlah baris per tabel — supaya admin bisa langsung mengecek kewajaran
    // angka ini (mis. dibandingkan dengan tampilan jumlah data di menu lain)
    // tanpa harus membuka isi file JSON yang bisa sangat besar.
    row_counts: {
      ...Object.fromEntries(BACKUP_TABLES.map(t => [t, backupData[t]?.length ?? 0])),
      _storage_assets: storageAssets.length,
    },
    tables: backupData,
    // File biner dari Supabase Storage (logo & gambar soal), lihat
    // backupStorageAssets(). Field ini opsional agar file backup versi lama
    // (tanpa key `storage`) tetap valid untuk direstore.
    storage: { assets: storageAssets },
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="smartexam-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
