import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/pengawas/sesi/[id]/siswa
// Mengembalikan daftar siswa yang sudah masuk ujian dalam sesi tertentu
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['PENGAWAS', 'GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  // Ambil semua siswa_ujian untuk sesi ini
  const { data: siswaUjian, error } = await db
    .from('siswa_ujian')
    .select('nis, status, waktu_daftar, waktu_mulai, waktu_selesai')
    .eq('sesi_id', sesiId)
    .order('waktu_daftar', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!siswaUjian?.length) return NextResponse.json({ data: [] })

  // Ambil nama dan kelas siswa
  const nisList = siswaUjian.map(s => s.nis)
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama, kelas')
    .in('nis', nisList)
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, { nama: s.nama, kelas: s.kelas }]))

  // Ambil jumlah pelanggaran tiap siswa
  const { data: pelanggaranList } = await db
    .from('pelanggaran')
    .select('nis, level')
    .eq('sesi_id', sesiId)
    .in('nis', nisList)

  // Hitung jumlah pelanggaran per siswa (count seluruh entri)
  const pelanggaranMap: Record<string, number> = {}
  for (const p of pelanggaranList ?? []) {
    pelanggaranMap[p.nis] = (pelanggaranMap[p.nis] ?? 0) + 1
  }

  // Ambil kode reset aktif (kode 7 digit untuk siswa yang di-reset)
  const { data: resetList } = await db
    .from('log_reset')
    .select('nis, password_baru, digunakan, created_at')
    .in('nis', nisList)
    .eq('digunakan', false)
    .order('created_at', { ascending: false })

  // Kode reset aktif per siswa (yang belum digunakan)
  const resetMap: Record<string, string> = {}
  for (const r of resetList ?? []) {
    if (!resetMap[r.nis]) resetMap[r.nis] = r.password_baru
  }

  return NextResponse.json({
    data: siswaUjian.map(s => ({
      nis: s.nis,
      nama: siswaMap[s.nis]?.nama ?? s.nis,
      kelas: siswaMap[s.nis]?.kelas ?? '-',
      status: s.status,
      waktu_daftar: s.waktu_daftar,
      waktu_selesai: s.waktu_selesai,
      jumlah_pelanggaran: pelanggaranMap[s.nis] ?? 0,
      kode_reset: resetMap[s.nis] ?? null,
    }))
  })
}
