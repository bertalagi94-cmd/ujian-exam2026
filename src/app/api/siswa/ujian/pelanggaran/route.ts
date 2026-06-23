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

  // FIX BUG #2: Dedup pelanggaran di sisi server.
  // Sebelumnya: client punya ref pelanggaranActiveRef untuk mencegah event ganda
  // (fullscreenchange + visibilitychange + blur bisa muncul bersamaan untuk 1
  // kejadian fisik). Tapi ref itu hilang saat tab di-reload/suspend OS → laporan
  // duplikat dikirim ulang dan tercatat sebagai pelanggaran baru.
  // Sekarang: cek apakah sudah ada pelanggaran dari nis+sesi yang sama dalam
  // 5 detik terakhir. Kalau ada → anggap event duplikat, kembalikan data lama
  // tanpa insert entri baru / menaikkan level.
  const window5s = new Date(Date.now() - 5000).toISOString()
  const { data: recentPelanggaran } = await db
    .from('pelanggaran')
    .select('id, level, status')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .gte('created_at', window5s)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentPelanggaran) {
    // Event duplikat — kembalikan pelanggaran yang sudah ada tanpa insert baru
    const [batasPelanggaran] = await Promise.all([getBatasPelanggaran(db)])
    return NextResponse.json({
      perlu_reset: true,
      level: recentPelanggaran.level,
      batasPelanggaran,
      message: `Pelanggaran ke-${recentPelanggaran.level} terdeteksi. Hubungi pengawas untuk mendapatkan kode lanjut ujian.`,
    })
  }

  // Bukan duplikat — proses normal
  const [batasPelanggaran, { count }] = await Promise.all([
    getBatasPelanggaran(db),
    db.from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!),
  ])

  const level = (count ?? 0) + 1

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
