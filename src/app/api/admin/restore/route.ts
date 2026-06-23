import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Urutan hapus: reverse FK agar tidak melanggar constraint
const DELETE_ORDER = [
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
]

// Urutan insert: parent dulu
const INSERT_ORDER = [
  'pengaturan',
  'kelas',
  'mapel',
  'kelas_mapel',
  'siswa',
  'users',
  'jadwal',
  'paket_soal',
  'soal',
  'kisi_kisi',
  'sesi_ujian',
  'siswa_ujian',
  'jawaban',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
]

// Filter delete per tabel sesuai kolom yang tersedia
async function clearTable(
  db: ReturnType<typeof import('@/lib/supabase').createAdminClient>,
  table: string
): Promise<string | null> {
  try {
    let error: { message: string } | null = null

    if (table === 'users') {
      // users: hapus semua kecuali ADMIN
      ;({ error } = await (db as any).from('users').delete().neq('role', 'ADMIN'))
    } else if (table === 'pengaturan') {
      // pengaturan: PK = key (TEXT), pakai updated_at
      ;({ error } = await (db as any).from('pengaturan').delete().not('key', 'is', null))
    } else if (table === 'siswa') {
      // siswa: PK = nis (TEXT)
      ;({ error } = await (db as any).from('siswa').delete().not('nis', 'is', null))
    } else if (table === 'siswa_ujian' || table === 'jawaban' || table === 'log_reset') {
      // BIGSERIAL PK — pakai gt 0
      ;({ error } = await (db as any).from(table).delete().gt('id', 0))
    } else {
      // Semua tabel lain (termasuk kisi_kisi) punya id TEXT
      ;({ error } = await (db as any).from(table).delete().not('id', 'is', null))
    }

    return error ? `${table}: ${error.message}` : null
  } catch (e) {
    return `${table}: ${e instanceof Error ? e.message : 'error'}`
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let payload: {
    version?: string
    app?: string
    tables: Record<string, unknown[]>
  }

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'File backup tidak valid (bukan JSON)' }, { status: 400 })
  }

  if (!payload?.tables || typeof payload.tables !== 'object') {
    return NextResponse.json(
      { error: 'Format backup tidak dikenali. Pastikan file adalah backup SmartExam.' },
      { status: 400 }
    )
  }

  // Validasi tambahan: pastikan file memang dari SmartExam (bukan JSON acak)
  if (payload.app && payload.app !== 'SmartExam') {
    return NextResponse.json(
      { error: 'File backup bukan dari aplikasi SmartExam.' },
      { status: 400 }
    )
  }

  // Pastikan minimal ada satu tabel yang dikenal di dalam backup
  const KNOWN_TABLES = new Set(DELETE_ORDER)
  const tableKeys = Object.keys(payload.tables)
  const hasKnownTable = tableKeys.some(k => KNOWN_TABLES.has(k))
  if (!hasKnownTable) {
    return NextResponse.json(
      { error: 'File backup tidak mengandung data yang dikenali. Pastikan file adalah backup SmartExam yang valid.' },
      { status: 400 }
    )
  }

  const db = createAdminClient()
  const deleteErrors: string[] = []

  // 1. Hapus data lama
  for (const table of DELETE_ORDER) {
    if (!(table in payload.tables)) continue
    const err = await clearTable(db, table)
    if (err) deleteErrors.push(err)
  }

  if (deleteErrors.length > 0) {
    return NextResponse.json(
      { error: 'Gagal membersihkan data lama', details: deleteErrors },
      { status: 500 }
    )
  }

  // 2. Insert data dari backup
  const errors: string[] = []
  const stats: Record<string, number> = {}

  for (const table of INSERT_ORDER) {
    let rows = payload.tables[table]
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      stats[table] = 0
      continue
    }

    // Tabel users: skip row ADMIN karena tidak dihapus saat clear,
    // sehingga tidak akan terjadi duplicate key yang menghentikan seluruh insert
    if (table === 'users') {
      rows = rows.filter((r: any) => r.role !== 'ADMIN')
      if (rows.length === 0) {
        stats[table] = 0
        continue
      }
    }

    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      try {
        const { error } = await (db as any).from(table).insert(batch)
        if (error) {
          errors.push(`Gagal insert ${table} (batch ${Math.floor(i / BATCH) + 1}): ${error.message}`)
          break
        }
        inserted += batch.length
      } catch (e) {
        errors.push(`Gagal insert ${table}: ${e instanceof Error ? e.message : 'error'}`)
        break
      }
    }
    stats[table] = inserted
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Restore selesai dengan beberapa error', details: errors, stats },
      { status: 207 }
    )
  }

  return NextResponse.json({ message: 'Restore berhasil', stats })
}
