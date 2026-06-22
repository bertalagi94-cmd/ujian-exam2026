import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const since5m = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const todayStr = now.toISOString().split('T')[0]

  const t0 = Date.now()

  const [
    { data: logAktivitas },
    { data: sesiAktif },
    { count: loginHariIni },
    { count: aktifitasBaru },
    { data: pelanggaran },
    { data: ujianBerjalan },
  ] = await Promise.all([
    // 30 log aktivitas terbaru semua role
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(30),

    // sesi ujian yang sedang berjalan
    db.from('sesi_ujian')
      .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta, status')
      .eq('status', 'BERJALAN')
      .order('waktu_mulai', { ascending: false }),

    // login hari ini
    db.from('log_aktivitas')
      .select('*', { count: 'exact', head: true })
      .eq('aksi', 'LOGIN')
      .gte('created_at', todayStr),

    // aktivitas 5 menit terakhir
    db.from('log_aktivitas')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since5m),

    // pelanggaran terbaru (24 jam)
    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(10),

    // jadwal ujian berjalan hari ini
    db.from('jadwal')
      .select('id, mapel_id, kelas, jam_mulai, jam_selesai, status')
      .eq('tanggal', todayStr)
      .in('status', ['BERJALAN', 'AKTIF']),
  ])

  const dbResponseMs = Date.now() - t0

  // Hitung status server berdasarkan response time DB dan beban aktif
  const sesiCount = (sesiAktif ?? []).length
  const aktifitas5m = aktifitasBaru ?? 0

  let serverStatus: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS'
  let serverScore: number // 0-100

  if (dbResponseMs < 200 && sesiCount <= 3 && aktifitas5m <= 20) {
    serverStatus = 'AMAN'; serverScore = 10
  } else if (dbResponseMs < 500 && sesiCount <= 8 && aktifitas5m <= 50) {
    serverStatus = 'NORMAL'; serverScore = 35
  } else if (dbResponseMs < 1000 && sesiCount <= 15 && aktifitas5m <= 100) {
    serverStatus = 'WASPADA'; serverScore = 60
  } else if (dbResponseMs < 2000) {
    serverStatus = 'BERAT'; serverScore = 80
  } else {
    serverStatus = 'KRITIS'; serverScore = 95
  }

  // Kelompokkan log per role dari aksi (prefix konvensi: GURU_, SISWA_, ADMIN_, PENGAWAS_)
  const logs = (logAktivitas ?? []) as { id: string; user_id: string; aksi: string; detail: string; created_at: string }[]

  return NextResponse.json({
    server: {
      status: serverStatus,
      score: serverScore,
      dbResponseMs,
      timestamp: now.toISOString(),
    },
    aktivitas: {
      loginHariIni: loginHariIni ?? 0,
      aktifitas5MenitTerakhir: aktifitas5m,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: (pelanggaran ?? []).length,
    },
    logs,
    sesiAktif: sesiAktif ?? [],
    ujianHariIni: ujianBerjalan ?? [],
    pelanggaran: (pelanggaran ?? []).slice(0, 5),
  })
}
