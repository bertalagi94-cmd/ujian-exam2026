import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'

export const dynamic = 'force-dynamic'

// Panel Developer: daftar sekolah (yayasan). HANYA metadata — nama, status,
// tanggal, jumlah siswa. Tidak ada isi data siswa, jawaban, atau nilai.
// Sekolah baru masuk lewat pengajuan (/api/developer/pengajuan), bukan dibuat manual.
export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data: yayasan, error } = await db.from('yayasan')
    .select('id, kode, nama, status, created_at, aktif_at').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Hanya hitungan (head: true), tidak ada baris siswa yang dibaca.
  const data = await Promise.all((yayasan ?? []).map(async (y: any) => {
    const { count } = await db.from('siswa')
      .select('nis', { count: 'exact', head: true }).eq('yayasan_id', y.id)
    return { ...y, jumlah_siswa: count ?? 0 }
  }))
  return NextResponse.json({ data })
}
