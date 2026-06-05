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

  // Count existing violations for this siswa in this sesi
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

  // Setiap pelanggaran → set status RESET (siswa harus tunggu kode dari pengawas)
  // Pengawas yang memutuskan kapan di-reset dengan memberikan kode 7 digit
  // Jika sudah 3x pelanggaran → TERKUNCI permanen setelah pengawas melakukan reset ke-3
  return NextResponse.json({ 
    perlu_reset: true, 
    level, 
    message: `Pelanggaran ke-${level} terdeteksi. Hubungi pengawas untuk mendapatkan kode lanjut ujian.` 
  })
}
