import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000)

  const dbStart = Date.now()
  const [
    { data: logs },
    { data: sesiAktifRaw },
    { data: pelanggaranRaw },
    { count: loginHariIni },
    { count: aktifitas5Menit },
    { count: sesiUjianAktif },
    { count: pelanggaranHariIni },
    // Poin 1: Nama mapel
    { data: mapelList },
    // Poin 3: Nama siswa di pelanggaran
    { data: siswaList },
    // Poin 5: Jumlah siswa sedang aktif mengerjakan
    { count: siswaAktifMengerjakan },
    // Poin 6: Submit hari ini
    { count: submitHariIni },
    // Poin 8: Maintenance mode
    { data: maintenanceRow },
  ] = await Promise.all([
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('sesi_ujian')
      .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta')
      .eq('status', 'BERJALAN')
      .order('waktu_mulai', { ascending: false }),
    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString())
      .eq('aksi', 'LOGIN'),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinsAgo.toISOString()),
    db.from('sesi_ujian')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'BERJALAN'),
    db.from('pelanggaran')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString()),
    // Ambil semua nama mapel (ringan, data kecil)
    db.from('mapel').select('id, nama'),
    // Ambil nama siswa untuk NIS yang ada di pelanggaran hari ini
    db.from('siswa').select('nis, nama'),
    // Count siswa yang sedang AKTIF mengerjakan (dari sesi yang BERJALAN)
    db.from('siswa_ujian')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'AKTIF'),
    // Count submit hari ini (waktu_selesai != null dan >= startOfDay)
    db.from('siswa_ujian')
      .select('id', { count: 'exact', head: true })
      .gte('waktu_selesai', startOfDay.toISOString()),
    // Maintenance mode
    db.from('pengaturan')
      .select('value')
      .eq('key', 'maintenanceAktif')
      .maybeSingle(),
  ])

  const dbResponseMs = Date.now() - dbStart

  // Map mapel_id → nama mapel
  const mapelMap: Record<string, string> = {}
  if (mapelList) {
    for (const m of mapelList) mapelMap[m.id] = m.nama
  }

  // Map nis → nama siswa
  const siswaMap: Record<string, string> = {}
  if (siswaList) {
    for (const s of siswaList) siswaMap[s.nis] = s.nama
  }

  // Enriched sesiAktif: tambahkan nama mapel + durasi berjalan
  const sesiAktif = (sesiAktifRaw ?? []).map((s: { id: string; kelas: string; mapel_id: string; waktu_mulai: string; jumlah_peserta: number }) => ({
    ...s,
    nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id,
    durasi_menit: Math.floor((now.getTime() - new Date(s.waktu_mulai).getTime()) / 60000),
  }))

  // Enriched pelanggaran: tambahkan nama siswa
  const pelanggaran = (pelanggaranRaw ?? []).map((p: { id: string; nis: string; jenis: string; created_at: string }) => ({
    ...p,
    nama_siswa: siswaMap[p.nis] ?? p.nis,
  }))

  const sesiCount = sesiUjianAktif ?? 0
  const score = Math.min(
    100,
    Math.round(
      (sesiCount / 20) * 40 +
      ((aktifitas5Menit ?? 0) / 100) * 30 +
      ((pelanggaranHariIni ?? 0) / 5) * 30
    )
  )

  const status =
    score >= 80 ? 'KRITIS' :
    score >= 60 ? 'BERAT' :
    score >= 40 ? 'WASPADA' :
    score >= 20 ? 'NORMAL' : 'AMAN'

  const maintenanceAktif =
    maintenanceRow?.value === 'true' || maintenanceRow?.value === '1'

  return NextResponse.json({
    server: {
      status,
      score,
      dbResponseMs,
      timestamp: now.toISOString(),
    },
    aktivitas: {
      loginHariIni: loginHariIni ?? 0,
      aktifitas5MenitTerakhir: aktifitas5Menit ?? 0,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: pelanggaranHariIni ?? 0,
      // Poin 5 & 6
      siswaAktifMengerjakan: siswaAktifMengerjakan ?? 0,
      submitHariIni: submitHariIni ?? 0,
    },
    logs: logs ?? [],
    sesiAktif,          // enriched: + nama_mapel, durasi_menit
    pelanggaran,        // enriched: + nama_siswa
    maintenanceAktif,   // Poin 8
  })
}
