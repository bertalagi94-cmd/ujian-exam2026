import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const guruUsername = user.username

  // Cek apakah guru ini adalah wali kelas (ada di kolom wali_kelas di tabel kelas)
  const { data: kelasWali, error: kelasError } = await db
    .from('kelas')
    .select('*')
    .eq('wali_kelas', guruUsername)
    .single()

  if (kelasError || !kelasWali) {
    return NextResponse.json({ isWaliKelas: false, kelas: null, mapelList: [], siswaList: [], nilaiRekap: [] })
  }

  const kelasId = kelasWali.id

  // Ambil semua mapel yang terdaftar di kelas ini (dari kelas_mapel)
  const { data: kelasMapelList } = await db
    .from('kelas_mapel')
    .select('*')
    .eq('kelas_id', kelasId)

  if (!kelasMapelList || kelasMapelList.length === 0) {
    return NextResponse.json({ isWaliKelas: true, kelas: kelasWali, mapelList: [], siswaList: [], nilaiRekap: [] })
  }

  // Ambil semua siswa di kelas ini
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama, status')
    .eq('kelas', kelasId)
    .eq('status', 'AKTIF')
    .order('nama')

  const totalSiswa = siswaList?.length ?? 0
  const mapelIds = kelasMapelList.map(km => km.mapel_id)

  // Ambil jadwal ujian untuk kelas ini
  const { data: jadwalList } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', kelasId)
    .in('mapel_id', mapelIds)
    .order('tanggal', { ascending: true })

  // Ambil nilai untuk semua siswa di kelas ini
  const { data: nilaiList } = await db
    .from('nilai')
    .select('nis, mapel_id, nilai, grade, lulus, sesi_id, timestamp')
    .eq('kelas', kelasId)
    .in('mapel_id', mapelIds)

  // Per mapel: hitung sudah berapa yang ujian, belum siapa
  const mapelEnriched = kelasMapelList.map(km => {
    // Cari jadwal terkait mapel ini
    const jadwalMapel = (jadwalList ?? []).filter(j => j.mapel_id === km.mapel_id)
    const lastJadwal = jadwalMapel[jadwalMapel.length - 1] ?? null

    // Cari nilai untuk mapel ini
    const nilaiMapel = (nilaiList ?? []).filter(n => n.mapel_id === km.mapel_id)
    const sudahUjian = new Set(nilaiMapel.map(n => n.nis))

    // Siswa yang belum ujian
    const belumUjian = (siswaList ?? []).filter(s => !sudahUjian.has(s.nis))

    const rataRata = nilaiMapel.length
      ? Math.round(nilaiMapel.reduce((s, r) => s + (r.nilai || 0), 0) / nilaiMapel.length)
      : null

    return {
      ...km,
      jadwal: lastJadwal,
      sudahUjian: sudahUjian.size,
      totalSiswa,
      belumUjianSiswa: belumUjian.map(s => ({ nis: s.nis, nama: s.nama })),
      rataRata,
      nilaiList: nilaiMapel,
    }
  })

  // Rekap nilai per siswa per mapel (untuk tabel)
  const nilaiRekap = (siswaList ?? []).map(siswa => {
    const row: Record<string, unknown> = { nis: siswa.nis, nama: siswa.nama }
    mapelIds.forEach(mapelId => {
      const nilaiSiswa = (nilaiList ?? []).find(n => n.nis === siswa.nis && n.mapel_id === mapelId)
      row[mapelId] = nilaiSiswa ? { nilai: nilaiSiswa.nilai, grade: nilaiSiswa.grade, lulus: nilaiSiswa.lulus } : null
    })
    return row
  })

  return NextResponse.json({
    isWaliKelas: true,
    kelas: kelasWali,
    mapelList: mapelEnriched,
    siswaList,
    nilaiRekap,
  })
}
