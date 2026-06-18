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
  jawaban_nilai: ['pelanggaran', 'nilai', 'jawaban'],
  sesi_ujian: ['pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian'],
  soal_paket: ['pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'paket_soal'],
  jadwal: ['pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'paket_soal', 'jadwal'],
  siswa: ['pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'siswa'],
  kelas_mapel: ['pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'paket_soal', 'jadwal', 'kelas_mapel', 'mapel', 'kelas'],
  users: ['users'],
  log: ['log_aktivitas', 'log_reset'],
  pengaturan: ['pengaturan'],
  semua: [
    'log_aktivitas',
    'log_reset',
    'pelanggaran',
    'nilai',
    'jawaban',
    'siswa_ujian',
    'sesi_ujian',
    'soal',
    'paket_soal',
    'jadwal',
    'users',
    'siswa',
    'kelas_mapel',
    'mapel',
    'kelas',
    'pengaturan',
  ],
}

// Tabel dengan kolom created_at (bisa filter pakai gt)
const HAS_CREATED_AT = new Set([
  'pelanggaran', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian',
  'soal', 'paket_soal', 'jadwal', 'siswa', 'kelas_mapel', 'mapel',
  'kelas', 'pengaturan', 'log_aktivitas', 'log_reset',
])

// Mapping tabel ke kolom waktu yang benar sesuai schema
const TABLE_TIME_COLUMN: Record<string, string> = {
  nilai: 'timestamp',          // tabel nilai pakai kolom 'timestamp'
  jawaban: 'updated_at',       // tabel jawaban pakai kolom 'updated_at'
  siswa_ujian: 'waktu_daftar', // tabel siswa_ujian pakai kolom 'waktu_daftar'
}

async function clearTable(
  db: ReturnType<typeof import('@/lib/supabase').createAdminClient>,
  table: string
): Promise<string | null> {
  try {
    // Tabel users: JANGAN hapus ADMIN — hanya hapus GURU, PENGAWAS, KEPSEK
    if (table === 'users') {
      const { error } = await (db as any)
        .from('users')
        .delete()
        .neq('role', 'ADMIN')
      return error ? `users: ${error.message}` : null
    }

    // Tabel dengan PK bukan 'id'
    if (table === 'pengaturan') {
      const { error } = await (db as any)
        .from('pengaturan')
        .delete()
        .not('key', 'is', null)
      return error ? `pengaturan: ${error.message}` : null
    }
    if (table === 'siswa') {
      const { error } = await (db as any).from('siswa').delete().not('nis', 'is', null)
      return error ? `siswa: ${error.message}` : null
    }

    // Gunakan kolom waktu yang sesuai per tabel
    const timeCol = TABLE_TIME_COLUMN[table] ?? (HAS_CREATED_AT.has(table) ? 'created_at' : null)
    if (timeCol) {
      const { error } = await (db as any)
        .from(table)
        .delete()
        .gt(timeCol, '1970-01-01')
      return error ? `${table}: ${error.message}` : null
    }

    // Fallback untuk tabel lain (pakai PK id)
    const { error } = await (db as any)
      .from(table)
      .delete()
      .not('id', 'is', null)
    return error ? `${table}: ${error.message}` : null

  } catch (e) {
    return `${table}: ${e instanceof Error ? e.message : 'error'}`
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let body: { categories: ResetCategory[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const { categories } = body

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

  // Kumpulkan tabel unik dengan urutan yang benar
  const tablesToDelete: string[] = []
  for (const cat of effectiveCategories) {
    for (const table of CATEGORY_MAP[cat]) {
      if (!tablesToDelete.includes(table)) {
        tablesToDelete.push(table)
      }
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
