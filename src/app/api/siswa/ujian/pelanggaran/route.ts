import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cachedFetch } from '@/lib/cache'

async function getBatasPelanggaran(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const val = await cachedFetch('pengaturan:batasPelanggaran', 60, async () => {
    const { data } = await db.from('pengaturan').select('value').eq('key', 'batasPelanggaran').single()
    return data?.value ?? '3'
  })
  return parseInt(val as string, 10) || 3
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jenis, detail } = await req.json()

  // Sebelumnya: 2 query serial (~200ms total).
  // Sekarang: paralel + batasPelanggaran dari cache (~100ms, atau 0ms cache hit).
  const [batasPelanggaran, { count }] = await Promise.all([
    getBatasPelanggaran(db),
    db.from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!),
  ])

  const level = (count ?? 0) + 1

  // Insert pelanggaran & update status siswa_ujian secara paralel
  await Promise.all([
    db.from('pelanggaran').insert({
      id: generateId('PEL'),
      sesi_id: sesiId,
      nis: user.nis!,
      jenis,
      level,
      detail,
      status: 'BELUM_DITINDAKLANJUTI',
    }),
    db.from('siswa_ujian')
      .update({ status: 'RESET' })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!),
  ])

  return NextResponse.json({
    perlu_reset: true,
    level,
    batasPelanggaran,
    message: `Pelanggaran ke-${level} terdeteksi. Hubungi pengawas untuk mendapatkan kode lanjut ujian.`,
  })
}
