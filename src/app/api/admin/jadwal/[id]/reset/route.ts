// File: src/app/api/admin/jadwal/[id]/reset/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const jadwalId = params.id

  // 1. Ambil data jadwal
  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, mapel_id, kelas, status')
    .eq('id', jadwalId)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Jadwal tidak ditemukan.' }, { status: 404 })
  }

  // 2. Cek apakah jadwal sudah SELESAI
  if (jadwal.status !== 'SELESAI') {
    return NextResponse.json({
      error: 'Reset hanya bisa dilakukan pada jadwal yang sudah selesai dilaksanakan.',
    }, { status: 400 })
  }

  // 3. Ambil semua siswa di kelas ini
  const { data: semuaSiswa } = await db
    .from('siswa')
    .select('nis, nama')
    .eq('kelas', jadwal.kelas)
    .eq('status', 'AKTIF')
    .order('nama')

  if (!semuaSiswa?.length) {
    return NextResponse.json({ error: 'Tidak ada siswa aktif di kelas ini.' }, { status: 400 })
  }

  // 4. Ambil semua sesi ujian untuk jadwal ini
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('mapel_id', jadwal.mapel_id)
    .eq('kelas', jadwal.kelas)

  const sesiIds = (sesiList ?? []).map((s: any) => s.id)

  // 5. Ambil NIS siswa yang sudah punya nilai di sesi ini
  let sudahUjianNis: string[] = []
  if (sesiIds.length > 0) {
    const { data: nilaiList } = await db
      .from('nilai')
      .select('nis')
      .in('sesi_id', sesiIds)

    sudahUjianNis = [...new Set((nilaiList ?? []).map((n: any) => n.nis))]
  }

  // 6. Cari siswa yang BELUM ujian
  const belumUjian = semuaSiswa.filter((s: any) => !sudahUjianNis.includes(s.nis))

  if (belumUjian.length > 0) {
    return NextResponse.json({
      error: 'Reset ditolak. Masih ada siswa yang belum mengikuti ujian.',
      belum_ujian: belumUjian,
    }, { status: 400 })
  }

  // 7. Semua siswa sudah ujian — lakukan reset
  await db
    .from('jadwal')
    .update({ status: 'AKTIF' })
    .eq('id', jadwalId)

  return NextResponse.json({ message: 'Jadwal berhasil direset.' })
}
