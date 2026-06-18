import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Urutan hapus: balik dari backup agar tidak melanggar FK constraint
const DELETE_ORDER = [
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
  'sesi_ujian',
  'siswa_ujian',
  'jawaban',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
]

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

  const db = createAdminClient()
  const errors: string[] = []
  const stats: Record<string, number> = {}

  // 1. Hapus semua data (reverse FK order)
  for (const table of DELETE_ORDER) {
    if (!(table in payload.tables)) continue
    try {
      const { error } = await db
        .from(table as never)
        .delete()
        .gt('created_at' as never, '1970-01-01' as never)

      if (error) {
        // Fallback: filter dengan kolom lain yang pasti ada
        const { error: e2 } = await db
          .from(table as never)
          .delete()
          .not('id' as never, 'is' as never, null as never)

        if (e2) {
          errors.push(`Gagal hapus ${table}: ${error.message}`)
        }
      }
    } catch (e) {
      errors.push(`Gagal hapus ${table}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Gagal membersihkan data lama', details: errors },
      { status: 500 }
    )
  }

  // 2. Insert data dari backup
  for (const table of INSERT_ORDER) {
    const rows = payload.tables[table]
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      stats[table] = 0
      continue
    }

    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      try {
        const { error } = await db.from(table as never).insert(batch as never[])
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
