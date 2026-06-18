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
    return NextResponse.json({ error: 'Format backup tidak dikenali. Pastikan file adalah backup SmartExam.' }, { status: 400 })
  }

  const db = createAdminClient()
  const errors: string[] = []
  const stats: Record<string, number> = {}

  // 1. Hapus semua data yang ada (reverse order)
  for (const table of DELETE_ORDER) {
    if (!(table in payload.tables)) continue
    const { error } = await db.from(table).delete().neq('id' as never, '00000000-0000-0000-0000-000000000000' as never).catch(() => ({ error: { message: 'Delete failed' } }))
    if (error) {
      // Coba alternatif jika kolom id tidak ada atau berbeda
      const fallback = await db.from(table).delete().gte('id' as never, 0 as never).catch(() => ({ error }))
      if (fallback.error) {
        errors.push(`Gagal hapus ${table}: ${error.message}`)
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({
      error: 'Gagal membersihkan data lama',
      details: errors,
    }, { status: 500 })
  }

  // 2. Insert data dari backup
  for (const table of INSERT_ORDER) {
    const rows = payload.tables[table]
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      stats[table] = 0
      continue
    }

    // Insert per batch 100 baris
    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await db.from(table).insert(batch as never[])
      if (error) {
        errors.push(`Gagal insert ${table} (batch ${i / BATCH + 1}): ${error.message}`)
        break
      }
      inserted += batch.length
    }
    stats[table] = inserted
  }

  if (errors.length > 0) {
    return NextResponse.json({
      error: 'Restore selesai dengan beberapa error',
      details: errors,
      stats,
    }, { status: 207 })
  }

  return NextResponse.json({
    message: 'Restore berhasil',
    stats,
  })
}
