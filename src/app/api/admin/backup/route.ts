import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Hanya tabel yang ada di schema (kisi_kisi DIHAPUS - tidak ada di 01_schema.sql)
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
  'sesi_ujian',
  'siswa_ujian',
  'jawaban',
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

  const payload = {
    version: '1.0',
    app: 'SmartExam',
    exported_at: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
    // Jumlah baris per tabel — supaya admin bisa langsung mengecek kewajaran
    // angka ini (mis. dibandingkan dengan tampilan jumlah data di menu lain)
    // tanpa harus membuka isi file JSON yang bisa sangat besar.
    row_counts: Object.fromEntries(
      BACKUP_TABLES.map(t => [t, backupData[t]?.length ?? 0])
    ),
    tables: backupData,
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="smartexam-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
