import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Kategori reset yang tersedia
export type ResetCategory =
  | 'jawaban_nilai'      // Jawaban & Nilai siswa
  | 'sesi_ujian'        // Sesi & Siswa Ujian
  | 'soal_paket'        // Soal & Paket Soal
  | 'jadwal'            // Jadwal Ujian
  | 'siswa'             // Data Siswa
  | 'kelas_mapel'       // Kelas & Mata Pelajaran
  | 'users'             // Data User (non-admin)
  | 'log'               // Log Aktivitas & Reset
  | 'pengaturan'        // Pengaturan Sistem
  | 'semua'             // Semua data (factory reset)

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

async function deleteTable(db: ReturnType<typeof import('@/lib/supabase').createAdminClient>, table: string): Promise<string | null> {
  // Hapus dengan filter yang dijamin true (semua baris)
  const { error } = await (db as any).from(table).delete().not('id', 'is', null)
  if (error) {
    // Fallback: coba dengan filter berbeda
    const { error: e2 } = await (db as any).from(table).delete().gte('created_at', '1970-01-01')
    if (e2) {
      // Last resort
      const { error: e3 } = await (db as any).rpc('truncate_table', { table_name: table })
      if (e3) return `${table}: ${error.message}`
    }
  }
  return null
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

  // Kalau ada 'semua', gunakan hanya CATEGORY_MAP['semua']
  const effectiveCategories = categories.includes('semua') ? ['semua' as ResetCategory] : categories

  // Kumpulkan semua tabel yang perlu dihapus (deduplicate, pertahankan urutan)
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
    const err = await deleteTable(db, table)
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
