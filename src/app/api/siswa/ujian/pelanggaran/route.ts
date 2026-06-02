import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jenis, detail } = await req.json()

  // Count existing violations
  const { count } = await db
    .from('pelanggaran')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  const level = (count ?? 0) + 1

  await db.from('pelanggaran').insert({
    id: generateId('PEL'),
    sesi_id: sesiId,
    nis: user.nis!,
    jenis,
    level,
    detail,
    status: 'BELUM_DITINDAKLANJUTI',
  })

  // Get batas pelanggaran from pengaturan
  const { data: setting } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', 'batasPelanggaran')
    .single()

  const batas = parseInt(setting?.value ?? '3')

  if (level >= batas) {
    // Lock siswa
    await db.from('siswa_ujian')
      .update({ status: 'TERKUNCI' })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
    return NextResponse.json({ terkunci: true, level, message: 'Akun dikunci karena melebihi batas pelanggaran' })
  }

  return NextResponse.json({ terkunci: false, level, sisaPeringatan: batas - level })
}
