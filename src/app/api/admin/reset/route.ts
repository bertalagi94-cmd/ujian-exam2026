import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

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

// Map kategori → tabel yang dihapus (urutan reverse FK)
const CATEGORY_MAP: Record<ResetCategory, string[]> = {
  jawaban_nilai: ['pelanggaran', 'log_reset', 'nilai', 'jawaban'],
  sesi_ujian:   ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian'],
  soal_paket:   ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'kisi_kisi', 'paket_soal'],
  // Sengaja HANYA menghapus tabel jadwal — nilai/jawaban adalah bukti
  // siswa sudah mengikuti ujian dan tidak boleh ikut terhapus di sini.
  // Kalau admin memang ingin reset nilai/jawaban juga, pakai kategori
  // 'jawaban_nilai' secara terpisah (bisa dipilih bersamaan dari UI).
  jadwal:       ['jadwal'],
  siswa:        ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'siswa'],
  kelas_mapel:  ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'kisi_kisi', 'paket_soal', 'jadwal', 'siswa', 'kelas_mapel', 'mapel', 'kelas'],
  users:        ['log_aktivitas', 'log_reset', 'users'],
  log:          ['log_aktivitas', 'log_reset'],
  pengaturan:   ['pengaturan'],
  // BUG FIX: tabel `sekolah` (fitur jenjang/Kepsek) sebelumnya tidak pernah
  // ikut dihapus oleh kategori manapun, termasuk 'semua' (reset total).
  // Ditambahkan di sini saja (bukan di 'kelas_mapel') karena 'kelas_mapel'
  // tidak menghapus tabel `users`, dan `users.sekolah_id` adalah FK ke
  // tabel ini — menghapus sekolah di kategori itu bisa melanggar FK kalau
  // ada akun Kepsek yang masih menunjuk ke sekolah tersebut. Di 'semua',
  // `users` dan `kelas` sudah dihapus lebih dulu sehingga aman.
  semua: [
    'log_aktivitas',
    'log_reset',
    'pelanggaran',
    'nilai',
    'jawaban',
    'siswa_ujian',
    'sesi_ujian',
    'soal',
    'kisi_kisi',
    'paket_soal',
    'jadwal',
    'users',
    'siswa',
    'kelas_mapel',
    'mapel',
    'kelas',
    'sekolah',
    'pengaturan',
  ],
}

// Tabel yang datanya bisa sangat besar → pakai TRUNCATE via RPC
// agar tidak timeout di Vercel, eksekusi langsung di dalam database
const TRUNCATE_TABLES = new Set(['jawaban', 'siswa_ujian', 'nilai', 'pelanggaran', 'log_reset', 'log_aktivitas'])

// Tabel yang tidak ada di schema (legacy) → skip
const SKIP_TABLES = new Set(['kisi_kisi'])

const TABLE_FILTER: Record<string, { col: string; method: 'gt_epoch' | 'not_null' | 'gt_zero' }> = {
  pengaturan: { col: 'key',       method: 'not_null' },
  siswa:      { col: 'nis',       method: 'not_null' },
  log_reset:  { col: 'id',        method: 'gt_zero'  },
}

const HAS_CREATED_AT = new Set([
  'sesi_ujian', 'soal', 'paket_soal', 'jadwal',
  'kelas_mapel', 'mapel', 'kelas', 'log_aktivitas',
])

async function clearTable(
  db: ReturnType<typeof import('@/lib/supabase').createAdminClient>,
  table: string
): Promise<string | null> {
  // Skip tabel yang tidak ada di schema
  if (SKIP_TABLES.has(table)) return null

  try {
    // Tabel besar → pakai TRUNCATE via RPC (eksekusi di DB, tidak timeout)
    if (TRUNCATE_TABLES.has(table)) {
      const { error } = await (db as any).rpc('truncate_tabel_besar', { nama_tabel: table })
      return error ? `${table}: ${error.message}` : null
    }

    // Tabel users: jangan hapus ADMIN
    if (table === 'users') {
      const { error } = await (db as any).from('users').delete().neq('role', 'ADMIN')
      return error ? `users: ${error.message}` : null
    }

    // Tabel dengan filter kolom spesifik
    const spec = TABLE_FILTER[table]
    if (spec) {
      let q = (db as any).from(table).delete()
      if (spec.method === 'gt_epoch') q = q.gt(spec.col, '1970-01-01')
      else if (spec.method === 'not_null') q = q.not(spec.col, 'is', null)
      else if (spec.method === 'gt_zero') q = q.gt(spec.col, 0)
      const { error } = await q
      return error ? `${table}: ${error.message}` : null
    }

    // Tabel dengan created_at standar
    if (HAS_CREATED_AT.has(table)) {
      const { error } = await (db as any).from(table).delete().gt('created_at', '1970-01-01')
      return error ? `${table}: ${error.message}` : null
    }

    // Fallback: PK id TEXT
    const { error } = await (db as any).from(table).delete().not('id', 'is', null)
    return error ? `${table}: ${error.message}` : null

  } catch (e) {
    return `${table}: ${e instanceof Error ? e.message : 'error'}`
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

  // ── CEK AKTIVITAS SEBELUM RESET ─────────────────────────────────────────
  // Tolak reset jika ada sesi ujian yang sedang berjalan atau siswa yang
  // sedang aktif mengerjakan. Admin harus konfirmasi paksa (force=true) hanya
  // jika kondisi sudah diketahui dan tetap ingin dilanjutkan.
  if (!force) {
    const db = createAdminClient()
    const [{ data: sesiAktif }, { data: siswaAktif }] = await Promise.all([
      db.from('sesi_ujian').select('id', { count: 'exact', head: false }).eq('status', 'BERJALAN').limit(1),
      db.from('siswa_ujian').select('id', { count: 'exact', head: false }).eq('status', 'AKTIF').limit(1),
    ])

    const adaSesi = (sesiAktif?.length ?? 0) > 0
    const adaSiswa = (siswaAktif?.length ?? 0) > 0

    if (adaSesi || adaSiswa) {
      const pesan: string[] = []
      if (adaSesi) pesan.push('ada sesi ujian yang sedang berjalan')
      if (adaSiswa) pesan.push('ada siswa yang sedang mengerjakan ujian')
      return NextResponse.json({
        error: `Reset tidak bisa dilakukan karena ${pesan.join(' dan ')}. Tutup semua sesi terlebih dahulu, lalu coba lagi.`,
        ada_aktivitas: true,
        ada_sesi: adaSesi,
        ada_siswa: adaSiswa,
      }, { status: 409 })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const validCategories = Object.keys(CATEGORY_MAP) as ResetCategory[]
  const invalid = categories.filter(c => !validCategories.includes(c))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Kategori tidak valid: ${invalid.join(', ')}` }, { status: 400 })
  }

  const effectiveCategories = categories.includes('semua')
    ? ['semua' as ResetCategory]
    : categories

  // Kumpulkan tabel unik dengan urutan yang benar
  const tablesToDelete: string[] = []
  for (const cat of effectiveCategories) {
    for (const table of CATEGORY_MAP[cat]) {
      if (!tablesToDelete.includes(table)) tablesToDelete.push(table)
    }
  }

  const db = createAdminClient()
  const errors: string[] = []
  const deleted: string[] = []

  for (const table of tablesToDelete) {
    const err = await clearTable(db, table)
    if (err) {
      errors.push(err)
    } else {
      deleted.push(table)
    }
  }

  if (errors.length > 0 && deleted.length === 0) {
    return NextResponse.json({ error: 'Reset gagal', details: errors }, { status: 500 })
  }

  return NextResponse.json({
    message: errors.length > 0 ? 'Reset selesai dengan beberapa error' : 'Reset berhasil',
    deleted,
    errors: errors.length > 0 ? errors : undefined,
  }, { status: errors.length > 0 ? 207 : 200 })
}
