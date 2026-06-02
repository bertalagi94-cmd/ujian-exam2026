import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/siswa/ujian/sync
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jawaban } = await req.json()

  if (!Array.isArray(jawaban) || jawaban.length === 0) {
    return NextResponse.json({ message: 'Tidak ada jawaban untuk disimpan' })
  }

  const records = jawaban.map((j: { soal_id: string; jawaban: string }) => ({
    sesi_id: sesiId,
    nis: user.nis!,
    soal_id: j.soal_id,
    jawaban: j.jawaban,
    updated_at: new Date().toISOString(),
    sync_status: 'SYNCED',
    local_timestamp: Date.now(),
  }))

  const { error } = await db
    .from('jawaban')
    .upsert(records, { onConflict: 'sesi_id,nis,soal_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: `${records.length} jawaban tersimpan` })
}
