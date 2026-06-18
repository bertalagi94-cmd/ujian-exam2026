import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Tabel yang dibackup — urutan penting untuk restore (parent dulu)
const BACKUP_TABLES = [
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

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const backupData: Record<string, unknown[]> = {}
  const errors: string[] = []

  for (const table of BACKUP_TABLES) {
    const { data, error } = await db.from(table).select('*').order('id' as never, { ascending: true }).catch(() => ({ data: null, error: { message: 'Query failed' } }))
    if (error) {
      // Coba tanpa order jika tidak ada kolom id
      const fallback = await db.from(table).select('*').catch(() => ({ data: null, error }))
      if (fallback.error || !fallback.data) {
        errors.push(`${table}: ${error.message}`)
        backupData[table] = []
      } else {
        backupData[table] = fallback.data
      }
    } else {
      backupData[table] = data ?? []
    }
  }

  const payload = {
    version: '1.0',
    app: 'SmartExam',
    exported_at: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
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
