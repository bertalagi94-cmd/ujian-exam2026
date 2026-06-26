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
  sesi_ujian: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian'],
  soal_paket: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'kisi_kisi', 'paket_soal'],
  jadwal: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'kisi_kisi', 'paket_soal', 'jadwal'],
  siswa: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'siswa'],
  kelas_mapel: ['pelanggaran', 'log_reset', 'nilai', 'jawaban', 'siswa_ujian', 'sesi_ujian', 'soal', 'kisi_kisi', 'paket_soal', 'jadwal', 'siswa', 'kelas_mapel', 'mapel', 'kelas'],
  users: ['log_aktivitas', 'log_reset', 'users'],
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
    'kisi_kisi',
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

// Mapping tabel ke kolom filter yang benar sesuai schema.
// Tabel yang tidak terdaftar di sini akan di-delete via .not('id', 'is', null).
const TABLE_FILTER: Record<string, { col: string; method: 'gt_epoch' | 'not_null' | 'gt_zero' }> = {
  // Kolom waktu non-standar
  nilai:      { col: 'timestamp',    method: 'gt_epoch' },
  jawaban:    { col: 'updated_at',   method: 'gt_epoch' },
  siswa_ujian:{ col: 'waktu_daftar', method: 'gt_epoch' },
  kisi_kisi:  { col: 'updated_at',   method: 'gt_epoch' }, // tidak ada created_at; pakai updated_at
  // PK bukan 'id'
  pengaturan: { col: 'key',          method: 'not_null'  },
  siswa:      { col: 'nis',          method: 'not_null'  },
  // BIGSERIAL PK
  log_reset:  { col: 'id',           method: 'gt_zero'   },
  // Tabel users ditangani khusus (jangan hapus ADMIN)
}

// Tabel yang punya created_at standar — pakai gt epoch sebagai filter hapus
const HAS_CREATED_AT = new Set([
  'pelanggaran', 'sesi_ujian', 'soal', 'paket_soal', 'jadwal',
  'kelas_mapel', 'mapel', 'kelas', 'log_aktivitas',
])

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

    // Cek apakah ada filter spesifik untuk tabel ini
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
      const { error } = await (db as any)
        .from(table)
        .delete()
        .gt('created_at', '1970-01-01')
      return error ? `${table}: ${error.message}` : null
    }

    // Fallback: pakai PK id (TEXT)
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
